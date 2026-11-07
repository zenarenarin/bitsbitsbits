import * as THREE from 'three'
import gsap from 'gsap'
import { ChalkLine, ChalkDust, Bursts } from '../systems/chalk.js'
import { CameraRig } from '../systems/camera.js'
import { Dot } from '../systems/dot.js'
import { PALETTE, makeMaterials, block, ring, lightRig, mergeGeoms } from '../systems/kit.js'
import { Track, simulateSphere, simulateRail, aabb } from '../systems/physics.js'
import { textBlock, rise, lift, settle, splitChars } from '../systems/type.js'

/*
 * SCENE 02: CONNECTING DOTS
 *
 * Five things that have nothing to do with each other drift in a deep ocean
 * space, each with its own material, colour and rhythm. The line arrives from
 * Scene 01 and lassos them one by one. Each connection changes behaviour: the
 * object's own motion stops and it joins a shared, slow sway. Then the
 * connections contract: the objects are pulled together into a machine none of
 * them suggested. The line becomes a trajectory (a dashed preview of the path),
 * the pendulum strikes, and the Dot runs the machine: ramp, loop, steps.
 *
 * Physics: the run is simulated at build time (rail + free flight with
 * collisions) under a reduced gravity so it reads at presentation pace.
 */

const OCEAN = new THREE.Color('#123f4b')
const G = 3.4

export default {
  id: 's02',
  title: 'Connecting dots',
  create(ctx) {
    const { typeRoot, audio } = ctx
    const scene = new THREE.Scene()
    scene.background = OCEAN.clone()
    scene.fog = new THREE.FogExp2(OCEAN.clone(), 0.035)
    const mats = makeMaterials(ctx.envMap)
    const rig = new CameraRig({ fov: 36 })
    const tl = gsap.timeline({ paused: true })
    const env = { fog: 0.12, light: 0, sway: 0, pull: 0, trajOpacity: 0, broken: 0, dotDrop: 0, point: 1 }

    const lights = lightRig(scene, {
      key: '#ffe6c8',
      rim: '#6a8cff',
      sky: '#4f8a96',
      ground: '#0a2129',
      keyPos: [-6, 11, 9],
      rimPos: [7, 5, -9],
      shadowSize: 8,
    })
    lights.key.target.position.set(0, -0.5, 0)

    // ---------------------------------------------------------------- the machine (assembled layout)
    const R = 0.3
    const PIVOT = new THREE.Vector3(-5.15, 3.35, 0)
    const STRING = 2.0
    const S = new THREE.Vector3(-4.42, 1.22, 0) // the Dot's resting place at the head of the ramp
    const DIR = new THREE.Vector3(2, -1, 0).normalize()
    const Q = S.clone().addScaledVector(DIR, 3.75)
    const O = new THREE.Vector3(0.35, 0.58, 0) // loop centre
    const RING_R = 1.25
    const RHO = RING_R - 0.08 - R
    const LB = new THREE.Vector3(O.x, O.y - RHO, 0)
    const ZOUT = 0.48

    // Parts. Each has an independent "free" pose and its machine pose.
    const parts = []
    const part = (mesh, machine, free, motion) => {
      const g = new THREE.Group()
      g.add(mesh)
      scene.add(g)
      const p = { g, mesh, machine, free, motion, w: { connect: 0 } }
      parts.push(p)
      return p
    }

    // 1. pendulum bob: a teal ceramic cube
    const bobMesh = new THREE.Mesh(block(0.62, 0.62, 0.62, 0.08), mats.ceramic(PALETTE.teal, { rough: 0.32 }))
    bobMesh.castShadow = bobMesh.receiveShadow = true
    const bob = part(bobMesh, { p: PIVOT.clone().add(new THREE.Vector3(0, -STRING, 0)), r: new THREE.Euler(0, 0, 0) }, { p: new THREE.Vector3(-6.6, 2.5, -1.6), r: new THREE.Euler(0.5, 0.6, 0.2) }, (t, o) => {
      o.r.set(0.5 + t * 0.35, 0.6 + t * 0.5, 0.2)
      o.p.y += Math.sin(t * 0.7) * 0.18
    })

    // 2. the Dot
    const dot = new Dot(ctx, { radius: R })
    dot.addTo(scene)
    dot.shadow.visible = false
    const dotPart = { free: new THREE.Vector3(-3.1, -1.55, 1.4), machine: S.clone() }

    // 3. the ramp: a cream slab with lips
    const rampLen = 3.95
    const rampMesh = new THREE.Mesh(rampGeom(rampLen), mats.matte('#eadbc2'))
    rampMesh.castShadow = rampMesh.receiveShadow = true
    const rampAngle = Math.atan2(DIR.y, DIR.x)
    const rampCenter = S.clone().addScaledVector(DIR, rampLen / 2 - 0.15).add(new THREE.Vector3(-DIR.y, DIR.x, 0).multiplyScalar(-(R + 0.08)))
    const ramp = part(rampMesh, { p: rampCenter, r: new THREE.Euler(0, 0, rampAngle) }, { p: new THREE.Vector3(-1.4, 2.9, -2.4), r: new THREE.Euler(0.3, -0.5, -0.1) }, (t, o) => {
      o.r.set(0.3 + Math.sin(t * 0.5) * 0.25, -0.5, -0.1 + Math.sin(t * 0.5 + 1) * 0.15)
    })

    // 4. the ring: cobalt, translucent
    const ringMesh = new THREE.Mesh(ring(RING_R, 0.16, 0.24), mats.translucent(PALETTE.cobalt, { opacity: 0.78 }))
    ringMesh.castShadow = true
    const ringPart = part(ringMesh, { p: O.clone(), r: new THREE.Euler(0, 0, 0) }, { p: new THREE.Vector3(2.9, 1.9, -1.4), r: new THREE.Euler(0.2, 0, 0.3) }, (t, o) => {
      o.r.set(0.2, t * 0.6, 0.3)
    })

    // 5. a tower of coral blocks that becomes a staircase with a backstop
    const stepW = 0.95
    const steps = [
      { m: new THREE.Vector3(2.35, -1.2, ZOUT), size: new THREE.Vector3(stepW, 0.5, 0.95) },
      { m: new THREE.Vector3(3.3, -1.75, ZOUT), size: new THREE.Vector3(stepW, 0.5, 0.95) },
      { m: new THREE.Vector3(4.25, -2.3, ZOUT), size: new THREE.Vector3(stepW, 0.5, 0.95) },
      { m: new THREE.Vector3(4.85, -1.85, ZOUT), size: new THREE.Vector3(0.28, 1.4, 0.95) },
    ]
    const towerBase = new THREE.Vector3(5.3, -2.2, 0.4)
    steps.forEach((s, i) => {
      const mesh = new THREE.Mesh(block(s.size.x, s.size.y, s.size.z, 0.07), mats.ceramic(i === 3 ? '#c96f62' : PALETTE.coral, { rough: 0.45, coat: 0.2 }))
      mesh.castShadow = mesh.receiveShadow = true
      const stackY = towerBase.y + [0.25, 0.75, 1.25, 1.95][i]
      s.part = part(mesh, { p: s.m.clone(), r: new THREE.Euler(0, 0, 0) }, { p: new THREE.Vector3(towerBase.x, stackY, towerBase.z), r: new THREE.Euler(0, 0.35 + i * 0.12, i === 3 ? Math.PI / 2 : 0) }, (t, o) => {
        const sway = Math.sin(t * 0.9 - i * 0.45) * 0.035 * (i + 1)
        o.p.x += sway * (i + 1) * 0.6
        o.r.z += sway
      })
    })

    // pendulum string and pivot pin appear with the machine
    const pin = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.5, 24), mats.metal('#d8b57a'))
    pin.rotation.x = Math.PI / 2
    pin.position.copy(PIVOT)
    pin.scale.setScalar(0.0001)
    scene.add(pin)
    const pend = new THREE.Group()
    pend.position.copy(PIVOT)
    scene.add(pend)
    const string = new ChalkLine([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, -STRING + 0.31, 0)], { segments: 40, width: 0.03, minPx: 1.6, seed: 12 })
    pend.add(string.mesh)

    // ---------------------------------------------------------------- the connecting line
    // Enters from the left (continuing Scene 01's exit), lassos each part at its rest pose.
    const lassoOrder = [bob, null, ramp, ringPart, steps[1].part]
    const restPos = [bob.free.p, dotPart.free, ramp.free.p, ringPart.free.p, new THREE.Vector3(towerBase.x, towerBase.y + 1.0, towerBase.z)]
    const lassoR = [0.62, 0.48, 1.25, 1.55, 1.25]
    const pts = []
    const entry = new THREE.CatmullRomCurve3([new THREE.Vector3(-16, 4.5, 3), new THREE.Vector3(-11.5, 3.6, 1), new THREE.Vector3(-8.6, 3.2, -0.6), restPos[0].clone().add(new THREE.Vector3(-lassoR[0] - 0.2, 0.25, 0))])
    pts.push(...entry.getSpacedPoints(160))
    const lassoU = []
    restPos.forEach((c, i) => {
      const r = lassoR[i]
      const start = pts[pts.length - 1].clone()
      // swing to the lasso's start, wind 1.15 turns, leave towards the next
      const a0 = Math.atan2(start.y - c.y, start.x - c.x)
      const n = 180
      const turn = Math.PI * 2 * 1.15
      for (let k = 1; k <= n; k++) {
        const th = a0 + (k / n) * turn * (i % 2 ? -1 : 1)
        const rr = r * (1 + 0.08 * Math.sin(k * 0.11)) * (k < 20 ? 1 + (20 - k) * 0.012 : 1)
        pts.push(new THREE.Vector3(c.x + Math.cos(th) * rr, c.y + Math.sin(th) * rr * 0.92, c.z + Math.sin(th) * 0.2))
      }
      lassoU.push(pts.length)
      if (i < restPos.length - 1) {
        const a = pts[pts.length - 1]
        const b = restPos[i + 1]
        const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, (i % 2 ? 1 : -1) * 0.9, 0.6))
        const nr = lassoR[i + 1]
        const bStart = b.clone().add(new THREE.Vector3(-nr * 0.95, (i % 2 ? 1 : -1) * nr * 0.3, 0))
        const c2 = new THREE.CatmullRomCurve3([a, mid, bStart])
        pts.push(...c2.getSpacedPoints(120).slice(1))
      }
    })
    const line = new ChalkLine(pts, { segments: 2200, width: 0.04, minPx: 1.4, maxPx: 6, seed: 4, fogColor: OCEAN, fogDensity: 0.02 })
    scene.add(line.mesh)
    const total = pts.length
    // arc-length fraction at each lasso's completion
    const cum = [0]
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
    const uAtIndex = (i) => cum[Math.min(i, total - 1)] / cum[total - 1]
    const uEntry = uAtIndex(160)
    const uLasso = lassoU.map((i) => uAtIndex(i - 1))
    const uLassoStart = lassoU.map((i) => uAtIndex(i - 181))
    const dust = new ChalkDust(line, { count: 380, speed: 3.6, opacity: 0.26 })
    scene.add(dust.points)
    const point = new THREE.Mesh(new THREE.SphereGeometry(0.05, 20, 12), new THREE.MeshBasicMaterial({ color: '#fff3dc', fog: false }))
    scene.add(point)

    // ---------------------------------------------------------------- the run (physics)
    const ramp1 = new THREE.LineCurve3(S.clone(), Q.clone())
    const trans = new THREE.CubicBezierCurve3(Q.clone(), Q.clone().addScaledVector(DIR, 0.45), new THREE.Vector3(LB.x - 0.55, LB.y, 0), LB.clone())
    const loopPts = []
    for (let k = 0; k <= 200; k++) {
      const th = -Math.PI / 2 + (k / 200) * Math.PI * 2
      loopPts.push(new THREE.Vector3(O.x + Math.cos(th) * RHO, O.y + Math.sin(th) * RHO, (k / 200) * ZOUT))
    }
    const loop = new THREE.CatmullRomCurve3(loopPts)
    const run = new THREE.CurvePath()
    run.add(ramp1)
    run.add(trans)
    run.add(loop)
    const track = new Track()
    const T_STRIKE = 0 // relative; offset applied at build of timeline
    const railEnd = simulateRail(track, {
      t0: T_STRIKE,
      curve: run,
      v0: 2.55,
      r: R,
      g: G,
      drag: 0.02,
      normalAt: (u, tan) => {
        const p = run.getPointAt(u)
        if (u > (ramp1.getLength() + trans.getLength()) / run.getLength()) return O.clone().sub(p).setZ(0).normalize()
        return new THREE.Vector3(-tan.y, tan.x, 0)
      },
    })
    const stepBoxes = steps.map((s, i) => aabb(s.m, s.size, { restitution: i === 3 ? 0.35 : 0.45, friction: 0.45 }))
    simulateSphere(track, {
      t0: railEnd.t,
      p: railEnd.p.clone(),
      v: railEnd.v.clone().setZ(0),
      q: railEnd.q,
      r: R,
      g: -G,
      boxes: stepBoxes,
      rolling: 1.6,
      duration: 7,
    })
    const RUN_DUR = track.duration
    const bursts = new Bursts({ capacity: 260, opacity: 0.42, life: 1.0 })
    scene.add(bursts.points)

    // The trajectory preview: the line becoming a path.
    const trajPts = []
    for (let i = 0; i < track.frames.length; i += 2) trajPts.push(track.frames[i].p.clone())
    const traj = new ChalkLine(trajPts, { segments: 900, width: 0.026, minPx: 1.2, maxPx: 4, seed: 9, dry: 1.2 })
    traj.material.fragmentShader = traj.material.fragmentShader.replace('if (vU > uHead || vU < uTail) discard;', 'if (vU > uHead || vU < uTail) discard;\n  if (fract(vU * uLen * 3.2) > 0.55) discard;')
    scene.add(traj.mesh)

    // ---------------------------------------------------------------- typography
    const kicker = textBlock(typeRoot, { cls: 'mono', size: 17, x: 124, y: 132, lines: ['02 &nbsp;&nbsp;Connecting dots'], color: 'rgba(241,231,212,0.6)' })
    const st = textBlock(typeRoot, {
      cls: 'display',
      size: 98,
      x: 117,
      y: 176,
      lh: 0.88,
      lines: ['Creativity is the power', 'of connecting dots', 'that are yet seemingly', '<span data-w="un">unconnected.</span>'],
    })
    const unChars = splitChars(st.words.un)
    gsap.set([...kicker.lines, ...st.lines], { yPercent: 112 })

    // ---------------------------------------------------------------- camera
    const wide = { x: 0.6, y: 1.3, z: 15.2, tx: -0.2, ty: 0.45, tz: 0, fov: 37 }
    rig.set({ ...wide, drift: 0.8 })

    const dotW = (dotPart.w = { connect: 0 })
    const pulse = { p0: 0, p1: 0, p2: 0, p3: 0, p4: 0 }

    // ================================================================= TIMELINE
    // intro: arrive from Scene 01
    tl.fromTo(env, { fog: 0.12 }, { fog: 0.035, duration: 2.2, ease: 'power2.out' }, 0)
    tl.fromTo(env, { light: 0 }, { light: 1, duration: 2.4, ease: 'power2.out' }, 0.2)
    const Hd = { u: 0 }
    // Match cut: Scene 01 ends on the line's head as a point at frame centre. We open on it.
    const E0 = new THREE.Vector3(-16, 4.5, 3)
    tl.fromTo(Hd, { u: 0.0015 }, { u: uEntry, duration: 2.0, ease: 'power2.inOut' }, 0.15)
    tl.fromTo(rig.s, { x: -17.5, y: 5.0, z: 14, tx: E0.x, ty: E0.y, tz: E0.z, fov: 30, drift: 0 }, { ...wide, drift: 0.8, duration: 2.7, ease: 'power3.inOut' }, 0.1)
    tl.fromTo(env, { point: 1 }, { point: 0, duration: 0.6 }, 1.6)
    tl.addLabel('apart', 2.9)

    // ---- BEAT: connect
    let t = 2.8
    const segDur = [1.15, 1.0, 1.15, 1.2, 1.1]
    restPos.forEach((_, i) => {
      // travel to the next object
      tl.to(Hd, { u: uLassoStart[i], duration: i === 0 ? 0.5 : 0.8, ease: 'power1.inOut' }, t)
      t += i === 0 ? 0.5 : 0.8
      // the object stills itself as the line reaches it, then is wound
      tl.to(i === 1 ? dotW : lassoOrder[i].w, { connect: 1, duration: 0.45, ease: 'power2.out' }, t - 0.3)
      if (i === 4) steps.forEach((s) => tl.to(s.part.w, { connect: 1, duration: 0.45, ease: 'power2.out' }, t - 0.3))
      tl.to(Hd, { u: uLasso[i], duration: segDur[i] * 0.75, ease: 'power1.inOut' }, t)
      tl.call(() => audio.chalk(segDur[i] * 0.75, 0.75), null, t)
      tl.call(() => audio.click(0.9 + i * 0.12), null, t + segDur[i] * 0.75)
      tl.to(pulse, { [`p${i}`]: 1, duration: 0.5, ease: 'power2.out' }, t + segDur[i] * 0.72)
      t += segDur[i] * 0.75 + 0.05
    })
    // connected: a single shared rhythm
    tl.to(env, { sway: 1, duration: 1.4, ease: 'sine.inOut' }, t - 0.6)
    tl.addLabel('connect', t + 0.6)

    // ---- BEAT: assemble (pull together) and run
    let ta = t + 0.7
    tl.to(line, { tail: 1, duration: 1.3, ease: 'power2.in' }, ta)
    tl.to(env, { sway: 0, duration: 0.6 }, ta)
    tl.to(env, { pull: 1, duration: 1.7, ease: 'power3.inOut' }, ta + 0.25)
    tl.call(() => audio.whoosh(1.4, 0.1), null, ta + 0.3)
    ;[0.95, 1.2, 1.4, 1.55, 1.7].forEach((d, i) => tl.call(() => audio.assemble(0.45 + i * 0.08), null, ta + 0.25 + d))
    tl.to(pin.scale, { x: 1, y: 1, z: 1, duration: 0.5, ease: 'back.out(3)' }, ta + 1.7)
    tl.fromTo(string, { head: 0 }, { head: 1, duration: 0.5, ease: 'power2.out' }, ta + 1.8)
    tl.to(rig.s, { x: 0.2, y: 1.0, z: 15.5, tx: -0.1, ty: 0.1, tz: 0, fov: 36, duration: 2.4, ease: 'power2.inOut' }, ta)
    // the line becomes a trajectory
    const tTraj = ta + 2.2
    tl.to(env, { trajOpacity: 1, duration: 0.2 }, tTraj)
    tl.fromTo(traj, { head: 0 }, { head: 1, duration: 1.3, ease: 'power1.inOut' }, tTraj)
    tl.call(() => audio.chalk(1.3, 0.45), null, tTraj)
    // the pendulum: wind back (anticipation), release, strike, follow through, settle
    const PEND = { a: 0 }
    const tWind = tTraj + 1.45
    tl.to(PEND, { a: -1.15, duration: 0.85, ease: 'power2.out' }, tWind)
    const tStrike = tWind + 0.85 + 0.45
    tl.to(PEND, { a: 0, duration: 0.45, ease: 'power2.in' }, tWind + 0.85)
    tl.call(() => audio.collide(0.8), null, tStrike)
    tl.to(PEND, { a: 0.22, duration: 0.35, ease: 'power2.out' }, tStrike)
    tl.to(PEND, { a: -0.08, duration: 0.6, ease: 'sine.inOut' }, tStrike + 0.35)
    tl.to(PEND, { a: 0, duration: 0.8, ease: 'sine.inOut' }, tStrike + 0.95)
    const RUN = { t: 0 }
    tl.to(RUN, { t: RUN_DUR, duration: RUN_DUR, ease: 'none' }, tStrike)
    tl.to(traj, { tail: 1, duration: RUN_DUR * 0.8, ease: 'none' }, tStrike)
    track.impacts.filter((im) => im.speed > 0.7).forEach((im, i) => {
      tl.call(() => audio.bounce(im.speed * 1.6), null, tStrike + im.t)
      bursts.add(tStrike + im.t, im.p, { count: Math.round(8 + im.speed * 8), speed: 0.35 + im.speed * 0.3, up: 0.2, normal: im.n, seed: i + 3 })
    })
    tl.call(() => audio.whoosh(1.1, 0.06), null, tStrike + 0.8)
    tl.addLabel('machine', tStrike + RUN_DUR + 0.4)

    // ---- BEAT: the statement
    const tS = tStrike + RUN_DUR + 0.5
    tl.to(rig.s, { x: -5.2, y: 4.55, z: 21, tx: -5.6, ty: 3.95, tz: 0, fov: 37, duration: 2.4, ease: 'power3.inOut' }, tS)
    rise(tl, kicker.lines, tS + 0.7, { duration: 0.9 })
    rise(tl, st.lines.slice(0, 3), tS + 0.8, { duration: 1.2, stagger: 0.1 })
    // UNCONNECTED arrives scattered and pulls itself together
    tl.fromTo(st.lines[3], { yPercent: 112 }, { yPercent: 0, duration: 1.0, ease: 'expo.out' }, tS + 1.15)
    tl.fromTo(unChars, { x: (i) => (i - 6) * 30, y: (i) => [10, -18, 6, -8, 20, -12, 4, -20, 12, -6, 16, 0][i % 12] * 1.4 }, { x: 0, y: 0, duration: 1.15, ease: 'power3.inOut', stagger: { each: 0.025, from: 'edges' }, immediateRender: false }, tS + 1.9)
    tl.set(unChars, { x: (i) => (i - 6) * 30, y: (i) => [10, -18, 6, -8, 20, -12, 4, -20, 12, -6, 16, 0][i % 12] * 1.4 }, tS + 1.15)
    tl.call(() => audio.click(1.3), null, tS + 2.95)
    tl.addLabel('statement', tS + 3.1)

    // ---- EXIT: the machine lets go, the Dot drops towards the next problem
    const tE = tS + 3.2
    lift(tl, [...kicker.lines, ...st.lines], tE, { duration: 0.55, stagger: 0.04 })
    tl.to(env, { broken: 1, duration: 2.6, ease: 'power2.out' }, tE + 0.3)
    tl.call(() => audio.disassemble(7), null, tE + 0.3)
    tl.to(env, { dotDrop: 1, duration: 1.9, ease: 'power2.in' }, tE + 0.6)
    tl.to(rig.s, { x: 3.8, y: -3.5, z: 11, tx: 4.2, ty: -6.5, tz: 0.5, fov: 40, duration: 2.6, ease: 'power2.inOut' }, tE + 0.4)
    tl.to(env, { light: 0.15, fog: 0.09, duration: 2.0, ease: 'power2.in' }, tE + 1.0)
    tl.addLabel('end', tE + 3.0)

    // ================================================================= UPDATE
    const tmpP = new THREE.Vector3()
    const tmpQ = new THREE.Quaternion()
    const tmpV = new THREE.Vector3()
    const o = { p: new THREE.Vector3(), r: new THREE.Euler() }
    const qa = new THREE.Quaternion()
    const qb = new THREE.Quaternion()
    const breakDir = parts.map((_, i) => new THREE.Vector3(Math.cos(i * 2.1) * 2.4, Math.sin(i * 1.7) * 1.6 - 0.6, Math.sin(i * 3.1) * 2.2))
    const pulseOf = (p) => (p === bob ? pulse.p0 : p === ramp ? pulse.p2 : p === ringPart ? pulse.p3 : pulse.p4)
    const pendQ = new THREE.Quaternion()
    const zAxis = new THREE.Vector3(0, 0, 1)

    function update(time) {
      const tt = tl.time()
      line.head = Hd.u
      line.boil(time)
      line.pointAt(Hd.u, point.position)
      point.scale.setScalar(Math.max(0.0001, env.point))
      point.visible = env.point > 0.001
      string.boil(time)
      traj.boil(time)
      traj.opacity = env.trajOpacity * 0.8
      bursts.uniforms.uT.value = tt
      scene.fog.density = env.fog
      lights.key.intensity = 5.2 * env.light
      lights.hemi.intensity = 0.18 + 0.32 * env.light
      lights.rim.intensity = 0.4 + 2.2 * env.light
      const swayY = Math.sin(time * 0.8) * 0.12 * env.sway
      const swayR = Math.sin(time * 0.8 - 0.6) * 0.05 * env.sway

      // pendulum angle (also drives the bob once assembled)
      pend.rotation.z = PEND.a
      pendQ.setFromAxisAngle(zAxis, PEND.a)

      parts.forEach((p, i) => {
        // free pose with its own motion, stilled as it connects
        o.p.copy(p.free.p)
        o.r.copy(p.free.r)
        p.motion(time, o)
        const fp = o.p.clone().lerp(p.free.p, p.w.connect)
        qa.setFromEuler(o.r).slerp(qb.setFromEuler(p.free.r), p.w.connect)
        fp.y += swayY
        // machine pose
        let mp = p.machine.p
        if (p === bob) mp = PIVOT.clone().add(new THREE.Vector3(0, -STRING, 0).applyQuaternion(pendQ))
        qb.setFromEuler(p.machine.r)
        if (p === bob) qb.premultiply(pendQ)
        // pull: each part follows a gentle arc with a small anticipation
        const k = THREE.MathUtils.clamp(env.pull * 1.25 - i * 0.05, 0, 1)
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        const pos = fp.clone().lerp(mp, e)
        pos.y += Math.sin(e * Math.PI) * 0.8
        pos.z += Math.sin(e * Math.PI) * 0.6
        // break apart
        if (env.broken > 0) pos.addScaledVector(breakDir[i], env.broken).add(new THREE.Vector3(0, -env.broken * env.broken * 1.2, 0))
        p.g.position.copy(pos)
        p.g.quaternion.copy(qa).slerp(qb, e)
        if (env.broken > 0) p.g.rotateOnAxis(breakDir[i].clone().normalize(), env.broken * 1.2)
        p.g.rotation.z += swayR * (1 - e)
        const pl = pulseOf(p)
        p.g.scale.setScalar(1 + Math.sin(pl * Math.PI) * 0.09)
      })

      // the Dot
      if (tt < tStrike) {
        o.p.copy(dotPart.free)
        o.p.y += Math.sin(time * 1.25) * 0.22 * (1 - dotW.connect)
        o.p.y += swayY
        const k = THREE.MathUtils.clamp(env.pull * 1.25 - 0.05, 0, 1)
        const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2
        tmpP.copy(o.p).lerp(S, e)
        tmpP.y += Math.sin(e * Math.PI) * 0.9
        dot.set(tmpP, null, undefined, 1, 1 + Math.sin(pulse.p1 * Math.PI) * 0.12)
      } else {
        track.sample(RUN.t, tmpP, tmpQ, tmpV)
        const def = track.deform(RUN.t, tmpV)
        if (env.dotDrop > 0) tmpP.y -= env.dotDrop * env.dotDrop * 9
        dot.set(tmpP, tmpQ, def.axis, def.k, 1)
      }
      pin.visible = pin.scale.x > 0.001
      string.mesh.visible = string.head > 0.001 && env.broken < 0.05
      rig.apply(time)
    }

    return {
      scene,
      camera: rig.camera,
      timeline: tl,
      beats: ['apart', 'connect', 'machine', 'statement'],
      exitLabel: 'end',
      ambience: 'ocean',
      update,
    }
  },
}

function rampGeom(len) {
  const t = 0.16
  const w = 0.9
  const parts = [block(len, t, w, 0.05), block(len, t * 1.9, 0.09, 0.04), block(len, t * 1.9, 0.09, 0.04)]
  parts[1].translate(0, t * 0.6, w / 2 - 0.045)
  parts[2].translate(0, t * 0.6, -w / 2 + 0.045)
  return mergeGeoms(parts)
}
