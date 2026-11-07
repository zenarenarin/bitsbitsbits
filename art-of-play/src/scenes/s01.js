import * as THREE from 'three'
import gsap from 'gsap'
import { ChalkLine, ChalkDust, Bursts, cornerPath, ensureSvgChalk, svgChalkPath } from '../systems/chalk.js'
import { CameraRig } from '../systems/camera.js'
import { Dot } from '../systems/dot.js'
import { PALETTE, makeMaterials, beam, growable, lightRig } from '../systems/kit.js'
import { Track, simulateSphere, aabb } from '../systems/physics.js'
import { chalkGridTexture, radialTexture } from '../systems/textures.js'
import { textBlock, rise, lift, settle, unsettle, stageRect } from '../systems/type.js'

/*
 * SCENE 01: WHAT WOULD YOU DO?
 *
 * A point in the dark. It moves, and leaves a line. The line wanders, loops, and
 * then draws three straight strokes in space: an open zig-zag. The camera finds
 * the one position from which the open end meets the start, and the drawing
 * closes into an impossible triangle. The line becomes matter. From its last curl
 * a dot is born, falls, and comes to rest on a world that cannot exist.
 *
 * Only the floor's shadow tells the truth: the structure is open.
 *
 * The impossible triangle only closes from viewpoints on the line through its
 * two ends. Any camera on that rail keeps the illusion intact, so the camera can
 * dolly and pan along it while the type composes around the structure. Leaving
 * the rail (the exit) breaks the illusion on purpose.
 */

const BG = new THREE.Color('#0b1822')
const OCEAN = new THREE.Color('#123f4b')

export default {
  id: 's01',
  title: 'What would you do?',
  create(ctx) {
    const { typeRoot, svgRoot, audio } = ctx
    const scene = new THREE.Scene()
    scene.background = BG.clone()
    scene.fog = new THREE.FogExp2(BG.clone(), 0.016)
    const mats = makeMaterials(ctx.envMap)
    const rig = new CameraRig({ fov: 32 })
    const tl = gsap.timeline({ paused: true })
    const env = { light: 0, floor: 0, fogMix: 0, point: 1, dotScale: 0, dotGlow: 0, curl: 1, structureGlow: 1 }

    // ---------------------------------------------------------------- geometry of the impossible
    const L = 4
    const W = 0.6
    const C0 = new THREE.Vector3(-2, -1, -2)
    const C1 = new THREE.Vector3(2, -1, -2)
    const C2 = new THREE.Vector3(2, 3, -2)
    const C3 = new THREE.Vector3(2, 3, 2)
    const D = new THREE.Vector3(1, 1, 1).normalize()
    const CENTROID = C0.clone().add(C1).add(C2).divideScalar(3)
    const RAIL = (dist) => C3.clone().addScaledVector(D, dist)
    const RAIL_D = 34
    const TAPER = RAIL_D / (RAIL_D + C0.distanceTo(C3))

    const structure = new THREE.Group()
    scene.add(structure)
    const beamMat = () => mats.ceramic('#ead2ab', { rough: 0.55, coat: 0.3 })
    const beams = []
    const addBeam = (len, pos, rot, taper = 1) => {
      const g = beam(len, W)
      if (taper !== 1) {
        // Forced perspective: the far end of the last beam is narrowed so, seen from
        // the rail, it matches the width of the beam it appears to join.
        const p = g.attributes.position
        for (let i = 0; i < p.count; i++) {
          const k = 1 + (taper - 1) * (p.getX(i) / len)
          p.setY(i, p.getY(i) * k)
          p.setZ(i, p.getZ(i) * k)
        }
        g.computeVertexNormals()
      }
      const m = beamMat()
      const gr = growable(m, len)
      const mesh = new THREE.Mesh(g, m)
      mesh.customDepthMaterial = gr.depth
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.position.copy(pos)
      mesh.rotation.set(...rot)
      mesh.visible = false
      structure.add(mesh)
      const b = { mesh, g: gr.uniforms }
      beams.push(b)
      return b
    }
    addBeam(L + W, C0.clone().add(new THREE.Vector3(-W / 2, 0, 0)), [0, 0, 0])
    addBeam(L, C1.clone().add(new THREE.Vector3(0, W / 2, 0)), [0, 0, Math.PI / 2])
    addBeam(L + W / 2, C2.clone().add(new THREE.Vector3(0, 0, W / 2)), [0, -Math.PI / 2, 0], TAPER)

    // ---------------------------------------------------------------- floor
    const FLOOR_Y = -4.4
    const gridTex = chalkGridTexture({ cells: 4, base: '#15232d', line: 'rgba(241,231,212,', seed: 9, alpha: 0.45 })
    gridTex.repeat.set(40, 40)
    const floorMat = new THREE.MeshStandardMaterial({ map: gridTex, roughness: 0.95, metalness: 0, transparent: true, opacity: 0 })
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), floorMat)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = FLOOR_Y
    floor.receiveShadow = true
    scene.add(floor)
    // A soft pool of darkness under the structure grounds it in the space.
    const pool = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: radialTexture({ alpha: 0.6 }), color: 0x000000, transparent: true, depthWrite: false, opacity: 0 }),
    )
    pool.rotation.x = -Math.PI / 2
    pool.position.set(1, FLOOR_Y + 0.01, -0.5)
    pool.scale.set(13, 13, 1)
    scene.add(pool)

    // ---------------------------------------------------------------- light
    const lights = lightRig(scene, {
      key: '#ffe9cf',
      rim: '#5b7fe0',
      sky: '#3a5d70',
      ground: '#0a1218',
      keyPos: [-5, 17, 10],
      rimPos: [-6, 6, -14],
      shadowSize: 9,
    })
    lights.key.target.position.set(0.5, 0, -1)
    const base = { hemi: 0.32, key: 5.2, rim: 1.4 }

    // ---------------------------------------------------------------- the line
    const P0 = new THREE.Vector3(-9.5, 2.6, 6)
    const free = new THREE.CatmullRomCurve3(
      [
        P0,
        new THREE.Vector3(-8.2, 2.7, 5.4),
        new THREE.Vector3(-6.4, 1.6, 4.6),
        new THREE.Vector3(-4.8, 0.2, 3.9),
        // a loop through depth
        new THREE.Vector3(-3.3, -0.6, 3.6),
        new THREE.Vector3(-2.1, 0.5, 3.1),
        new THREE.Vector3(-2.9, 1.8, 2.4),
        new THREE.Vector3(-4.2, 1.1, 2.2),
        new THREE.Vector3(-4.0, -0.2, 2.0),
        new THREE.Vector3(-2.9, -0.9, 0.9),
        new THREE.Vector3(-2.3, -1.0, -0.6),
        C0.clone().add(new THREE.Vector3(-0.05, 0, 0.6)),
        C0.clone(),
      ],
      false,
      'centripetal',
      0.5,
    )
    const freePts = free.getSpacedPoints(500)
    const structPts = cornerPath([C0, C1, C2, C3], 0.18, 40)
    const all = [...freePts, ...structPts.slice(1)]
    const freeLen = free.getLength()
    const structLen = L * 3
    const line = new ChalkLine(all, { segments: 1600, width: 0.045, minPx: 1.4, seed: 2, fogColor: BG, fogDensity: 0.016 })
    scene.add(line.mesh)
    const uC0 = freeLen / line.length
    const uC1 = (freeLen + L) / line.length
    const uC2 = (freeLen + 2 * L) / line.length
    const dust = new ChalkDust(line, { count: 420, speed: 3.2, opacity: 0.28 })
    scene.add(dust.points)

    // The curl the Dot is born from, drawn above the top beam, facing the rail.
    const DOT_R = 0.32
    const birth = new THREE.Vector3(2, 5.1, -0.4)
    const a1 = new THREE.Vector3().crossVectors(D, new THREE.Vector3(0, 1, 0)).normalize()
    const a2 = new THREE.Vector3().crossVectors(a1, D).normalize()
    const curlPts = []
    // approach from the end of the top beam, then wind into a circle
    const curlIn = new THREE.CatmullRomCurve3([
      C3.clone(),
      C3.clone().add(new THREE.Vector3(0.1, 0.8, 0.2)),
      birth.clone().addScaledVector(a1, 0.9).addScaledVector(a2, -0.4),
      birth.clone().addScaledVector(a1, DOT_R).addScaledVector(a2, 0),
    ])
    curlPts.push(...curlIn.getSpacedPoints(120))
    for (let i = 1; i <= 140; i++) {
      const th = (i / 140) * Math.PI * 2.15
      curlPts.push(birth.clone().addScaledVector(a1, Math.cos(th) * DOT_R).addScaledVector(a2, Math.sin(th) * DOT_R))
    }
    const curl = new ChalkLine(curlPts, { segments: 400, width: 0.04, minPx: 1.4, seed: 5, fogColor: BG, fogDensity: 0.016 })
    scene.add(curl.mesh)

    // The point of light that starts it all.
    const point = new THREE.Mesh(new THREE.SphereGeometry(0.045, 24, 16), new THREE.MeshBasicMaterial({ color: '#fff3dc', fog: false }))
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: haloTexture(), color: '#ffdcae', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
    )
    halo.scale.set(0.42, 0.42, 1)
    point.add(halo)
    point.position.copy(P0)
    scene.add(point)

    // ---------------------------------------------------------------- the Dot
    const topY = 3 + (W / 2) * ((1 + TAPER) / 2) - 0.012
    const dot = new Dot(ctx, {
      radius: DOT_R,
      ground: (x, z) => (Math.abs(x - 2) < W / 2 + 0.05 && z > -2.4 && z < 2.3 ? topY : FLOOR_Y),
    })
    dot.addTo(scene)
    const track = new Track()
    const T_FALL = 15.4
    simulateSphere(track, {
      t0: T_FALL,
      p: birth.clone(),
      v: new THREE.Vector3(0, 0, 0.55),
      r: DOT_R,
      boxes: [aabb(new THREE.Vector3(2, topY - W / 2, 0), new THREE.Vector3(W, W, 4.6), { restitution: 0.52, friction: 0.4 })],
      planes: [{ normal: new THREE.Vector3(0, 1, 0), constant: FLOOR_Y }],
      rolling: 1.35,
      duration: 6,
    })
    const T_REST = track.duration
    const bursts = new Bursts({ capacity: 300, opacity: 0.45, life: 1.1 })
    scene.add(bursts.points)
    track.impacts.forEach((im, i) => bursts.add(im.t, im.p, { count: Math.round(10 + im.speed * 6), speed: 0.5 + im.speed * 0.25, up: 0.25, seed: i + 1 }))

    // ---------------------------------------------------------------- the exit line
    const exitCurve = new THREE.CatmullRomCurve3(
      [
        new THREE.Vector3(2, topY + 0.02, 1.3),
        new THREE.Vector3(1.4, 4.6, 3.8),
        new THREE.Vector3(-2.5, 6.2, 6.0),
        new THREE.Vector3(-9, 6.0, 4.0),
        new THREE.Vector3(-15, 4.9, -3),
        new THREE.Vector3(-21, 4.0, -14),
        new THREE.Vector3(-30, 3.0, -30),
      ],
      false,
      'centripetal',
    )
    const exitLine = new ChalkLine(exitCurve, { segments: 900, width: 0.05, minPx: 1.5, seed: 8, fogColor: BG, fogDensity: 0.012 })
    scene.add(exitLine.mesh)

    // ---------------------------------------------------------------- typography
    ensureSvgChalk(svgRoot.ownerSVGElement)
    const kicker = textBlock(typeRoot, { cls: 'mono', size: 17, x: 124, y: 214, lines: ['01 &nbsp;&nbsp;Why we play'], color: 'rgba(241,231,212,0.6)' })
    const q = textBlock(typeRoot, {
      cls: 'display',
      size: 172,
      x: 116,
      y: 262,
      lh: 0.86,
      lines: ['What would', 'you do in a', '<span style="color:#e9b96e">perfect</span>', '<span style="color:#e9b96e">world?</span>'],
    })
    const quote = textBlock(typeRoot, {
      cls: 'primary',
      size: 70,
      x: 120,
      y: 300,
      lh: 1.06,
      lines: ['<span style="margin-left:-0.42em">“</span>The voluntary attempt', 'to overcome <span data-w="un">unnecessary</span>', '<span data-w="ob">obstacles.</span>”'],
    })
    const attrib = textBlock(typeRoot, {
      cls: 'mono',
      size: 17,
      x: 124,
      y: 600,
      lh: 1.9,
      lines: ['Bernard Suits', '<span style="opacity:.55">The Grasshopper · 1978</span>'],
      color: 'rgba(241,231,212,0.82)',
    })
    // A hand-drawn stroke linking the two words that carry the idea.
    let link = null
    {
      const un = stageRect(quote.words.un)
      const ob = stageRect(quote.words.ob)
      const y1 = un.y + un.h * 0.93
      const y2 = ob.y + ob.h * 0.93
      const d = `M ${un.x - 4} ${y1} C ${un.x + un.w * 0.4} ${y1 + 6}, ${un.x + un.w * 0.8} ${y1 + 3}, ${un.x + un.w + 6} ${y1 - 2}
                 C ${un.x + un.w + 40} ${y1 + 10}, ${ob.x + ob.w * 0.6} ${y2 - 52}, ${ob.x + ob.w * 0.3} ${y2 - 18}
                 C ${ob.x + ob.w * 0.05} ${y2 - 4}, ${ob.x - 10} ${y2 + 4}, ${ob.x + ob.w * 0.25} ${y2 + 5}
                 S ${ob.x + ob.w * 0.85} ${y2 + 2}, ${ob.x + ob.w + 8} ${y2 - 1}`
      link = svgChalkPath(svgRoot, d, { width: 6, color: '#e9b96e' })
    }
    ;[...q.lines, ...quote.lines, ...kicker.lines].forEach((l) => gsap.set(l, { yPercent: 112 }))
    gsap.set(attrib.lines, { opacity: 0 })

    // ---------------------------------------------------------------- camera shots
    const railShot = (dist, pan = 0, lift_ = 0, fov = 21) => {
      const p = RAIL(dist)
      const dir = CENTROID.clone().sub(p).normalize()
      const right = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize()
      const up = new THREE.Vector3().crossVectors(right, dir)
      const t = CENTROID.clone().addScaledVector(right, pan).addScaledVector(up, lift_)
      return { x: p.x, y: p.y, z: p.z, tx: t.x, ty: t.y, tz: t.z, fov }
    }
    rig.set({ x: -9.2, y: 2.75, z: 10.6, tx: P0.x, ty: P0.y, tz: P0.z, fov: 30, drift: 0.6 })

    // ================================================================= TIMELINE
    tl.addLabel('void', 0)

    // ---- BEAT 1: the line (0 to 12.2)
    const H = { u: 0 }
    tl.to(H, { u: 0.012, duration: 1.3, ease: 'sine.inOut' }, 0.25)
    tl.to(H, { u: 0.03, duration: 0.9, ease: 'sine.inOut' }, 1.85)
    tl.to(H, { u: uC0, duration: 4.0, ease: 'power1.in' }, 2.9)
    tl.to(H, { u: uC1, duration: 0.95, ease: 'power2.inOut' }, 6.95)
    tl.to(H, { u: uC2, duration: 0.95, ease: 'power2.inOut' }, 8.0)
    tl.to(H, { u: 1, duration: 0.95, ease: 'power2.inOut' }, 9.05)
    tl.to(curl, { head: 1, duration: 1.1, ease: 'power1.inOut' }, 10.05)
    tl.call(() => audio.chalk(1.3, 0.5), null, 0.25)
    tl.call(() => audio.chalk(0.9, 0.6), null, 1.85)
    tl.call(() => audio.chalk(4.0, 0.9), null, 2.9)
    tl.call(() => audio.chalk(0.95, 1), null, 6.95)
    tl.call(() => audio.chalk(0.95, 1), null, 8.0)
    tl.call(() => audio.chalk(0.95, 1), null, 9.05)
    tl.call(() => audio.chalk(1.1, 0.7), null, 10.05)
    // camera: follow the head, then step back to see the open zig-zag, then find the rail
    tl.to(rig.s, { follow: 1, duration: 2.6, ease: 'sine.inOut' }, 1.0)
    tl.to(rig.s, { x: -11, y: 7.5, z: 13, tx: 0, ty: 1, tz: -1, fov: 34, duration: 0.01 }, 5)
    tl.to(rig.s, { follow: 0, duration: 2.4, ease: 'power2.inOut' }, 6.2)
    const railA = railShot(RAIL_D, 0, 0.1, 19.5)
    tl.to(rig.s, { ...railA, drift: 0.25, duration: 3.4, ease: 'power3.inOut' }, 9.0)
    tl.to(env, { point: 0, duration: 0.8 }, 10.5)
    tl.call(() => audio.click(0.8), null, 12.3)
    tl.addLabel('line', 12.6)

    // ---- BEAT 2: matter (12.6 to T_REST)
    tl.to(env, { light: 1, duration: 2.2, ease: 'power2.inOut' }, 12.7)
    tl.to(env, { floor: 1, duration: 2.6, ease: 'power2.inOut' }, 12.9)
    tl.call(() => audio.swell(3.2, 61.7), null, 12.7)
    const growAt = [13.0, 13.85, 14.65]
    beams.forEach((b, i) => {
      tl.to(b.g.uGrow, { value: 1, duration: 0.95, ease: 'power3.inOut' }, growAt[i])
      tl.call(() => audio.assemble(0.55 + i * 0.12), null, growAt[i] + 0.85)
    })
    // The trailing line is drawn up into the structure: everything it was is now matter.
    tl.to(line, { tail: uC0, duration: 2.2, ease: 'power2.inOut' }, 13.2)
    tl.call(() => audio.chalk(1.6, 0.35), null, 13.3)
    tl.to(env, { curl: 0, duration: 0.5 }, T_FALL - 0.75)
    tl.to(env, { dotScale: 1, duration: 0.75, ease: 'back.out(2.2)' }, T_FALL - 0.85)
    tl.call(() => audio.collect(0.9), null, T_FALL - 0.8)
    track.impacts.forEach((im) => tl.call(() => audio.bounce(im.speed), null, im.t))
    tl.to(rig.s, { ...railShot(RAIL_D - 9, 0, 0.5, 19.5), duration: T_REST - 12.6, ease: 'sine.inOut' }, 12.6)
    tl.addLabel('matter', T_REST + 0.2)

    // ---- BEAT 3: the question
    const tQ = T_REST + 0.3
    tl.to(rig.s, { ...railShot(RAIL_D - 13, -4.0, 0.5, 25), duration: 2.4, ease: 'power3.inOut' }, tQ)
    rise(tl, kicker.lines, tQ + 0.9, { duration: 0.9 })
    rise(tl, q.lines, tQ + 1.0, { duration: 1.25, stagger: 0.11 })
    tl.call(() => audio.whoosh(1.0, 0.07), null, tQ + 1.0)
    tl.addLabel('question', tQ + 2.7)

    // ---- BEAT 4: Bernard Suits
    const tS = tQ + 2.8
    lift(tl, [...q.lines], tS, { duration: 0.6, stagger: 0.045 })
    tl.to(rig.s, { ...railShot(RAIL_D - 15, -3.6, 0.2, 25), duration: 3.2, ease: 'power2.inOut' }, tS)
    rise(tl, quote.lines, tS + 0.55, { duration: 1.15, stagger: 0.1 })
    settle(tl, attrib.lines, tS + 1.25)
    tl.to(link.draw, { v: 1, duration: 1.3, ease: 'power2.inOut' }, tS + 1.6)
    tl.call(() => audio.chalk(1.3, 0.5), null, tS + 1.6)
    tl.addLabel('suits', tS + 3.0)

    // ---- EXIT: the line leaves the world, and the illusion breaks behind it
    const tE = tS + 3.1
    lift(tl, [...kicker.lines, ...quote.lines], tE, { duration: 0.55, stagger: 0.04 })
    unsettle(tl, attrib.lines, tE)
    tl.to(link.draw, { v: 0, duration: 0.5, ease: 'power2.in' }, tE)
    tl.to(exitLine, { head: 1, duration: 3.9, ease: 'power1.in' }, tE + 0.35)
    tl.call(() => audio.chalk(2.2, 0.8), null, tE + 0.35)
    tl.call(() => audio.whoosh(2.4, 0.16), null, tE + 1.6)
    tl.to(rig.s, { follow: 1, duration: 1.6, ease: 'power2.inOut' }, tE + 0.5)
    tl.set(rig.s, { x: -11.5, y: 5.6, z: 9.5, tx: -30, ty: 3.0, tz: -30, fov: 30, drift: 0 }, tE + 2.0)
    tl.to(rig.s, { follow: 0, duration: 1.7, ease: 'power2.inOut' }, tE + 2.1)
    tl.to(env, { fogMix: 1, duration: 2.4, ease: 'power2.in' }, tE + 1.5)
    tl.to(env, { light: 0.25, floor: 0, duration: 2.2, ease: 'power2.in' }, tE + 1.6)
    tl.to(exitLine, { tail: 0.995, duration: 1.3, ease: 'power2.in' }, tE + 3.0)
    tl.to(env, { point: 1, duration: 0.5, ease: 'power2.out' }, tE + 3.5)
    tl.addLabel('end', tE + 4.3)

    // ================================================================= UPDATE
    const hp = new THREE.Vector3()
    const hp2 = new THREE.Vector3()
    const dp = new THREE.Vector3()
    const dq = new THREE.Quaternion()
    const dv = new THREE.Vector3()
    const col = new THREE.Color()
    const exitStart = tE + 0.35

    function update(time) {
      const t = tl.time()
      line.head = H.u
      line.boil(time)
      curl.boil(time)
      exitLine.boil(time)

      // the point rides the head of whichever line is being drawn
      if (t < exitStart) line.pointAt(H.u, hp)
      else exitLine.pointAt(exitLine.head, hp)
      point.position.copy(hp)
      const breath = 1 + Math.sin(time * 1.6) * 0.08
      point.scale.setScalar(env.point * breath)
      point.visible = env.point > 0.001

      // camera follow
      if (t < exitStart) {
        line.pointAt(Math.max(0, H.u - 0.006), hp2)
        rig.followTarget.lerpVectors(hp2, hp, 0.5)
        rig.followPos.copy(hp2).add(dp.set(1.2, 1.25, 6.4))
      } else {
        const u = exitLine.head
        exitLine.pointAt(u, hp)
        exitLine.pointAt(Math.max(0, u - 0.08), hp2)
        rig.followTarget.copy(hp)
        rig.followPos.copy(hp2).add(dp.set(3.5, 1.6, 9.5).multiplyScalar(1 - u * 0.25))
      }
      rig.apply(time)

      // light and atmosphere
      const k = env.light
      lights.hemi.intensity = 0.12 + base.hemi * k
      lights.key.intensity = base.key * k
      lights.rim.intensity = 0.3 + base.rim * k
      floorMat.opacity = env.floor
      pool.material.opacity = env.floor * 0.75
      col.copy(BG).lerp(OCEAN, env.fogMix)
      scene.background.copy(col)
      scene.fog.color.copy(col)
      exitLine.uniforms.uFogColor.value.copy(col)

      // beams appear the instant they start to grow
      beams.forEach((b) => (b.mesh.visible = b.g.uGrow.value > 0.001))

      // the curl gives way to the Dot
      curl.opacity = env.curl
      if (t < T_FALL) {
        dot.set(birth, null, undefined, 1, Math.max(0.0001, env.dotScale))
        dot.material.emissiveIntensity = (1 - env.dotScale) * 0.6
      } else {
        track.sample(t, dp, dq, dv)
        const def = track.deform(t, dv)
        dot.set(dp, dq, def.axis, def.k, 1)
        dot.material.emissiveIntensity = 0
      }
      dot.root.visible = env.dotScale > 0.0005
      bursts.uniforms.uT.value = t
    }

    return {
      scene,
      camera: rig.camera,
      timeline: tl,
      beats: ['void', 'line', 'matter', 'question', 'suits'],
      exitLabel: 'end',
      ambience: 'void',
      update,
    }
  },
}

function haloTexture() {
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const g = c.getContext('2d')
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64)
  r.addColorStop(0, 'rgba(255,240,215,0.9)')
  r.addColorStop(0.18, 'rgba(255,220,170,0.28)')
  r.addColorStop(1, 'rgba(255,200,140,0)')
  g.fillStyle = r
  g.fillRect(0, 0, 128, 128)
  return new THREE.CanvasTexture(c)
}
