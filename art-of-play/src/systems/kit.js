import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { fbmTexture } from './textures.js'

/*
 * THE KIT
 *
 * One family of objects: the same unit, bevel and surface language everywhere.
 *   UNIT  = 1 world unit. Beams and blocks are built on 0.5-unit multiples.
 *   BEVEL = 0.06 on small parts, 0.09 on structural parts. Never sharp, never blobby.
 * Materials are a short, fixed list. Colour comes from the palette, not from
 * arbitrary per-object choices.
 */

export const PALETTE = {
  navy: '#142b3a',
  ocean: '#164b59',
  cobalt: '#355cc9',
  teal: '#267b83',
  coral: '#d77f73',
  burnt: '#d96a43',
  amber: '#e9b96e',
  cream: '#f1e7d4',
  ink: '#0b1720',
}

let shared = null
function textures() {
  if (!shared) {
    shared = {
      rough: fbmTexture({ size: 256, seed: 21, lo: 0.75, hi: 1 }),
      bump: fbmTexture({ size: 256, seed: 5, octaves: [8, 16, 32, 64], lo: 0, hi: 1 }),
    }
    shared.rough.repeat.set(2, 2)
  }
  return shared
}

export function makeMaterials(envMap) {
  const t = textures()
  return {
    /** Matte painted: the default for structure. */
    matte(color, { rough = 0.88 } = {}) {
      return new THREE.MeshStandardMaterial({
        color,
        roughness: rough,
        roughnessMap: t.rough,
        metalness: 0,
        envMap,
        envMapIntensity: 0.35,
      })
    },
    /** Chalky: very dry, slightly toothy. For things that have just become matter. */
    chalky(color) {
      return new THREE.MeshStandardMaterial({
        color,
        roughness: 1,
        bumpMap: t.bump,
        bumpScale: 0.6,
        metalness: 0,
        envMap,
        envMapIntensity: 0.25,
      })
    },
    /** Soft ceramic: a satin glaze that holds a broad highlight. */
    ceramic(color, { rough = 0.38, coat = 0.45 } = {}) {
      return new THREE.MeshPhysicalMaterial({
        color,
        roughness: rough,
        roughnessMap: t.rough,
        metalness: 0,
        clearcoat: coat,
        clearcoatRoughness: 0.32,
        envMap,
        envMapIntensity: 0.7,
      })
    },
    /** Coloured translucent: a tinted, softly lit volume. Not glass, not neon. */
    translucent(color, { opacity = 0.62 } = {}) {
      return new THREE.MeshPhysicalMaterial({
        color,
        roughness: 0.22,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.1,
        transparent: true,
        opacity,
        envMap,
        envMapIntensity: 1.1,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    },
    /** A small metallic detail: pins, pivots, axles. */
    metal(color = '#c9a76b') {
      return new THREE.MeshStandardMaterial({ color, roughness: 0.32, metalness: 1, envMap, envMapIntensity: 1 })
    },
  }
}

// ------------------------------------------------------------------ geometry

export function block(w, h, d, bevel = 0.06, seg = 3) {
  return new RoundedBoxGeometry(w, h, d, seg, Math.min(bevel, w / 2.01, h / 2.01, d / 2.01))
}

/** A beam running from x = 0 to x = len, ready to grow along its length. */
export function beam(len, w, bevel = 0.09) {
  const g = new RoundedBoxGeometry(len, w, w, 4, bevel)
  g.translate(len / 2, 0, 0)
  return g
}

/** A ring with a squared, bevelled section: reads as machined, not as a doughnut. */
export function ring(radius = 1, section = 0.16, depth = 0.22, seg = 128) {
  const shape = new THREE.Shape()
  shape.absarc(0, 0, radius + section / 2, 0, Math.PI * 2, false)
  const hole = new THREE.Path()
  hole.absarc(0, 0, radius - section / 2, 0, Math.PI * 2, true)
  shape.holes.push(hole)
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: 0.035,
    bevelSize: 0.03,
    bevelSegments: 3,
    curveSegments: seg,
  })
  g.translate(0, 0, -depth / 2)
  return g
}

/** A ramp: a bevelled slab with a shallow lip on each long edge. */
export function ramp(len = 3, w = 0.9, t = 0.16) {
  const g = new THREE.BufferGeometry()
  const parts = [block(len, t, w, 0.05), block(len, t * 1.6, 0.08, 0.035), block(len, t * 1.6, 0.08, 0.035)]
  parts[1].translate(0, t * 0.5, w / 2 - 0.04)
  parts[2].translate(0, t * 0.5, -w / 2 + 0.04)
  return mergeGeoms(parts, g)
}

export function mergeGeoms(list) {
  const out = new THREE.BufferGeometry()
  const attrs = ['position', 'normal', 'uv']
  const data = { position: [], normal: [], uv: [] }
  const index = []
  let offset = 0
  for (const g0 of list) {
    const g = g0.index ? g0 : g0
    for (const a of attrs) if (g.attributes[a]) data[a].push(...g.attributes[a].array)
    if (g.index) for (const i of g.index.array) index.push(i + offset)
    else for (let i = 0; i < g.attributes.position.count; i++) index.push(i + offset)
    offset += g.attributes.position.count
  }
  out.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3))
  out.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3))
  if (data.uv.length) out.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2))
  out.setIndex(index)
  return out
}

// ------------------------------------------------------------------ chalk becomes matter

/**
 * Patch a material so its mesh grows along local +X from 0 to `len`.
 * Vertices beyond the growth front collapse onto it, so the end cap travels with
 * the front and the bevel at the start is never distorted. A chalk-coloured
 * band glows at the front while it moves: the moment a line turns into matter.
 */
export function growable(material, len, { glow = '#ffe9c4' } = {}) {
  const u = {
    uGrow: { value: 0 },
    uLen: { value: len },
    uGlow: { value: new THREE.Color(glow) },
    uGlowAmt: { value: 1 },
  }
  const patchVert = (shader) => {
    Object.assign(shader.uniforms, u)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uGrow; uniform float uLen; varying float vGX;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGX = transformed.x;\ntransformed.x = min(transformed.x, uGrow * uLen);')
  }
  material.onBeforeCompile = (shader) => {
    patchVert(shader)
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uGrow; uniform float uLen; uniform vec3 uGlow; uniform float uGlowAmt; varying float vGX;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float gd = uGrow * uLen - vGX;
        float gb = (1.0 - smoothstep(0.0, 0.55, max(gd, 0.0))) * uGlowAmt * step(uGrow, 0.999);
        totalEmissiveRadiance += uGlow * gb * 0.55;`,
      )
  }
  material.customProgramCacheKey = () => 'growable'
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  depth.onBeforeCompile = patchVert
  depth.customProgramCacheKey = () => 'growable-depth'
  return { uniforms: u, depth }
}

// ------------------------------------------------------------------ lighting

/**
 * A lighting rig: one large soft key that casts shadows, a cool rim from behind,
 * and a hemisphere fill tinted by the environment. Intensities are plain numbers
 * so GSAP can drive them as part of the choreography.
 */
export function lightRig(scene, { key = '#fff1dc', rim = '#6f8fff', sky = '#2b4a5c', ground = '#0b141b', shadowSize = 8, keyPos = [-6, 10, 6], rimPos = [5, 4, -8] } = {}) {
  const hemi = new THREE.HemisphereLight(sky, ground, 0.6)
  scene.add(hemi)
  const keyL = new THREE.DirectionalLight(key, 2.4)
  keyL.position.set(...keyPos)
  keyL.castShadow = true
  keyL.shadow.mapSize.set(2048, 2048)
  keyL.shadow.radius = 6
  keyL.shadow.blurSamples = 16
  keyL.shadow.bias = -0.0004
  keyL.shadow.normalBias = 0.02
  const c = keyL.shadow.camera
  c.left = -shadowSize
  c.right = shadowSize
  c.top = shadowSize
  c.bottom = -shadowSize
  c.near = 0.5
  c.far = 60
  scene.add(keyL)
  scene.add(keyL.target)
  const rimL = new THREE.DirectionalLight(rim, 1.2)
  rimL.position.set(...rimPos)
  scene.add(rimL)
  return { hemi, key: keyL, rim: rimL }
}
