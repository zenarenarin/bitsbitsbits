import * as THREE from 'three'

/** Small deterministic PRNG so every procedural texture is identical on every run. */
export function rng(seed = 1) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function canvas(w, h) {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return [c, c.getContext('2d')]
}

/** Film-grain tile for the CSS overlay. */
export function grainDataURL(size = 256, seed = 1) {
  const [c, g] = canvas(size, size)
  const img = g.createImageData(size, size)
  const r = rng(seed * 977)
  // Light and dark specks on transparency: normal alpha blending, no blend modes.
  for (let i = 0; i < size * size; i++) {
    const v = (r() + r() + r()) / 3 - 0.5
    const light = v > 0
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = light ? 255 : 0
    img.data[i * 4 + 3] = Math.min(255, Math.abs(v) * 2 * 255 * (light ? 0.55 : 1))
  }
  g.putImageData(img, 0, 0)
  return c.toDataURL()
}

/** Tileable value noise, used for mottling and roughness variation. */
function tileNoise(size, cells, seed) {
  const r = rng(seed)
  const grid = []
  for (let i = 0; i < cells * cells; i++) grid.push(r())
  const at = (x, y) => grid[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)]
  const s = (t) => t * t * (3 - 2 * t)
  return (px, py) => {
    const x = (px / size) * cells
    const y = (py / size) * cells
    const xi = Math.floor(x)
    const yi = Math.floor(y)
    const fx = s(x - xi)
    const fy = s(y - yi)
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * fx
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * fx
    return a + (b - a) * fy
  }
}

export function fbmTexture({ size = 256, seed = 3, octaves = [4, 8, 16, 32], lo = 0.5, hi = 1, color = false } = {}) {
  const [c, g] = canvas(size, size)
  const img = g.createImageData(size, size)
  const ns = octaves.map((o, i) => tileNoise(size, o, seed + i * 31))
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let v = 0
      let amp = 0.5
      let tot = 0
      for (const n of ns) {
        v += n(x, y) * amp
        tot += amp
        amp *= 0.55
      }
      v = lo + (hi - lo) * (v / tot)
      const i = (y * size + x) * 4
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255
      img.data[i + 3] = 255
    }
  g.putImageData(img, 0, 0)
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  if (color) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/**
 * Floor: a dark matte ground with a hand-chalked game grid. Lines are built from
 * many short, slightly wandering dabs so they read as drawn rather than rendered.
 */
export function chalkGridTexture({ size = 1024, cells = 4, base = '#16242f', line = 'rgba(241,231,212,', seed = 7, alpha = 1 } = {}) {
  const [c, g] = canvas(size, size)
  g.fillStyle = base
  g.fillRect(0, 0, size, size)
  const n = tileNoise(size, 6, seed)
  const img = g.getImageData(0, 0, size, size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const k = 0.86 + n(x, y) * 0.28
      img.data[i] *= k
      img.data[i + 1] *= k
      img.data[i + 2] *= k
    }
  g.putImageData(img, 0, 0)
  const r = rng(seed + 5)
  const step = size / cells
  const stroke = (x0, y0, x1, y1) => {
    const len = Math.hypot(x1 - x0, y1 - y0)
    const dabs = Math.floor(len / 1.6)
    for (let i = 0; i < dabs; i++) {
      const t = i / dabs
      const wob = Math.sin(t * 9 + r() * 0.3) * 0.8
      const x = x0 + (x1 - x0) * t + (y1 !== y0 ? wob : 0)
      const y = y0 + (y1 - y0) * t + (x1 !== x0 ? wob : 0)
      const a = (r() < 0.12 ? 0 : 0.08 + r() * 0.16) * alpha
      g.fillStyle = line + a + ')'
      g.fillRect(x - 1.4, y - 1.4, 2.4 + r() * 1.4, 2.4 + r() * 1.4)
    }
  }
  for (let k = 0; k <= cells; k++) {
    const p = Math.min(size - 1.5, Math.max(1.5, k * step))
    stroke(p, 0, p, size)
    stroke(0, p, size, p)
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/**
 * The Dot's skin: glazed burnt orange with amber mottling and a single hand-chalked
 * band around its equator, so rolling and spin are always legible.
 */
export function dotTexture({ w = 1024, h = 512, seed = 11 } = {}) {
  const [c, g] = canvas(w, h)
  const grd = g.createLinearGradient(0, 0, 0, h)
  grd.addColorStop(0, '#e8823f')
  grd.addColorStop(0.5, '#db6a32')
  grd.addColorStop(1, '#c2531f')
  g.fillStyle = grd
  g.fillRect(0, 0, w, h)
  const r = rng(seed)
  for (let i = 0; i < 900; i++) {
    const x = r() * w
    const y = r() * h
    const rad = 3 + r() * 26
    const rg = g.createRadialGradient(x, y, 0, x, y, rad)
    const amber = r() < 0.6
    rg.addColorStop(0, amber ? 'rgba(233,185,110,0.10)' : 'rgba(150,50,25,0.10)')
    rg.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = rg
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2)
  }
  // Chalk band.
  const y0 = h * 0.5
  for (let i = 0; i < 9000; i++) {
    const x = r() * w
    const y = y0 + (r() + r() - 1) * h * 0.022 + Math.sin((x / w) * Math.PI * 6) * 1.5
    const a = r() < 0.18 ? 0 : 0.35 + r() * 0.5
    g.fillStyle = `rgba(245,236,220,${a})`
    g.fillRect(x, y, 1.5 + r() * 2.5, 1 + r() * 1.5)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Soft radial falloff used for contact shadows and occlusion pools. */
export function radialTexture({ size = 256, inner = 0, outer = 0.5, alpha = 1 } = {}) {
  const [c, g] = canvas(size, size)
  const rg = g.createRadialGradient(size / 2, size / 2, size * inner, size / 2, size / 2, size * outer)
  rg.addColorStop(0, `rgba(0,0,0,${alpha})`)
  rg.addColorStop(0.55, `rgba(0,0,0,${alpha * 0.45})`)
  rg.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = rg
  g.fillRect(0, 0, size, size)
  return new THREE.CanvasTexture(c)
}
