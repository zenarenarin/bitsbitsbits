import * as THREE from 'three'
import { rng } from './textures.js'

/*
 * THE LINE
 *
 * The line travels through 3D space and must sit behind and inside matter, so it
 * is rendered in WebGL rather than SVG: a camera-facing ribbon whose width is
 * expressed in world units and projected, so it thins with distance. The chalk
 * treatment lives entirely in the fragment shader:
 *   - streaks running along the stroke (chalk deposits along the drag direction)
 *   - a broken, dry edge
 *   - fine tooth grain and occasional dropouts
 *   - pressure variation along its length
 *   - a slightly brighter, warmer head where it is being drawn
 * Draw-on, erase and boil are uniforms, so the line is fully seekable.
 * SVG is kept for flat graphic marks attached to typography.
 */

const NOISE = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(h21(i), h21(i+vec2(1,0)), u.x), mix(h21(i+vec2(0,1)), h21(i+vec2(1,1)), u.x), u.y);
}
`

const VERT = /* glsl */ `
attribute vec3 prev;
attribute vec3 next;
attribute float side;
attribute float u;
uniform vec2 uRes;
uniform float uWidth;
uniform float uMinPx;
uniform float uMaxPx;
uniform float uLen;
uniform float uHead;
uniform float uTail;
uniform float uTaper;
uniform float uSeed;
varying float vU;
varying float vSide;
varying float vDepth;
varying float vPx;
${NOISE}
void main(){
  mat4 mvp = projectionMatrix * modelViewMatrix;
  vec4 c = mvp * vec4(position, 1.0);
  vec4 p = mvp * vec4(prev, 1.0);
  vec4 n = mvp * vec4(next, 1.0);
  vec2 half_ = uRes * 0.5;
  vec2 cs = c.xy / c.w * half_;
  vec2 ps = p.xy / p.w * half_;
  vec2 ns = n.xy / n.w * half_;
  vec2 d1 = cs - ps; vec2 d2 = ns - cs;
  vec2 dir = normalize((length(d1) > 1e-4 ? normalize(d1) : vec2(0.0)) + (length(d2) > 1e-4 ? normalize(d2) : vec2(0.0)) + vec2(1e-6, 0.0));
  vec2 nrm = vec2(-dir.y, dir.x);

  // Pressure: the hand presses harder and lighter along the stroke.
  float s = u * uLen;
  float pressure = 0.78 + 0.44 * vn(vec2(s * 0.55, uSeed));
  // Taper the tail end and the drawing head like a real stroke.
  float headDist = (uHead - u) * uLen;
  float tailDist = (u - uTail) * uLen;
  float taper = smoothstep(0.0, uTaper, headDist) * 0.6 + 0.4;
  taper *= smoothstep(-0.01, uTaper * 0.8, tailDist) * 0.7 + 0.3;
  float px = uWidth * half_.y * projectionMatrix[1][1] / max(c.w, 0.001);
  px = clamp(px * pressure * taper, uMinPx, uMaxPx);
  vPx = px;
  c.xy += nrm * side * px / half_ * c.w;
  vU = u;
  vSide = side;
  vDepth = -(modelViewMatrix * vec4(position, 1.0)).z;
  gl_Position = c;
}
`

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHeadColor;
uniform float uOpacity;
uniform float uLen;
uniform float uHead;
uniform float uTail;
uniform float uSeed;
uniform float uBoil;
uniform float uDry;
uniform vec3 uFogColor;
uniform float uFogDensity;
varying float vU;
varying float vSide;
varying float vDepth;
varying float vPx;
${NOISE}
void main(){
  float s = vU * uLen;
  if (vU > uHead || vU < uTail) discard;
  float a = abs(vSide);
  float b = uBoil;
  // Dry, broken edge.
  float edgeN = vn(vec2(s * 9.0 + b * 3.1, vSide * 2.0 + uSeed)) - 0.5;
  float edge = 1.0 - smoothstep(0.62 + edgeN * 0.45 * uDry, 1.0, a);
  // Streaks along the drag direction.
  float streak = vn(vec2(s * 2.2, vSide * 5.5 + uSeed * 3.0 + b));
  streak = smoothstep(0.18, 0.7, streak);
  // Tooth grain and dropouts.
  float grain = vn(vec2(s * 46.0 + b * 7.0, vSide * 13.0 + uSeed));
  float drop = smoothstep(0.08, 0.32, vn(vec2(s * 3.4 + uSeed, 1.7 + b)));
  float alpha = edge * mix(0.55, 1.0, streak) * mix(0.62, 1.0, grain) * mix(0.55 * uDry + (1.0 - uDry), 1.0, drop);
  // Thin lines lose texture detail, so keep them a little more solid.
  alpha = mix(alpha, edge * 0.92, smoothstep(5.0, 1.5, vPx));
  // A warmer, brighter head where the chalk is being laid down.
  float hd = (uHead - vU) * uLen;
  float headGlow = (1.0 - smoothstep(0.0, 0.5, hd)) * step(uHead, 0.9999);
  vec3 col = mix(uColor, uHeadColor, headGlow * 0.5) * (1.0 + headGlow * 0.12);
  float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
  col = mix(col, uFogColor, fog * 0.85);
  gl_FragColor = vec4(col, alpha * uOpacity * (1.0 - fog * 0.6));
  #include <colorspace_fragment>
}
`

/** Uniformly resample a polyline or THREE.Curve into n points by arc length. */
export function resample(src, n) {
  let pts
  if (src.getSpacedPoints) pts = src.getSpacedPoints(n - 1)
  else {
    const dense = src
    const cum = [0]
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + dense[i].distanceTo(dense[i - 1]))
    const total = cum[cum.length - 1]
    pts = []
    let j = 1
    for (let i = 0; i < n; i++) {
      const d = (i / (n - 1)) * total
      while (j < dense.length - 1 && cum[j] < d) j++
      const t = (d - cum[j - 1]) / Math.max(1e-9, cum[j] - cum[j - 1])
      pts.push(dense[j - 1].clone().lerp(dense[j], Math.min(1, Math.max(0, t))))
    }
  }
  return pts
}

/** A polyline through corner points, with the corners slightly rounded like a hand would draw them. */
export function cornerPath(corners, radius = 0.25, stepsPerUnit = 24) {
  const out = []
  for (let i = 0; i < corners.length - 1; i++) {
    const a = corners[i]
    const b = corners[i + 1]
    const len = a.distanceTo(b)
    const ra = i > 0 ? Math.min(radius, len * 0.45) : 0
    const rb = i < corners.length - 2 ? Math.min(radius, len * 0.45) : 0
    const dir = b.clone().sub(a).normalize()
    const start = a.clone().addScaledVector(dir, ra)
    const end = b.clone().addScaledVector(dir, -rb)
    const steps = Math.max(2, Math.ceil(start.distanceTo(end) * stepsPerUnit))
    for (let k = 0; k <= steps; k++) out.push(start.clone().lerp(end, k / steps))
    if (rb > 0) {
      const c = corners[i + 2]
      const dir2 = c.clone().sub(b).normalize()
      const p0 = end
      const p2 = b.clone().addScaledVector(dir2, rb)
      const curve = new THREE.QuadraticBezierCurve3(p0, b.clone(), p2)
      const cp = curve.getPoints(10)
      for (let k = 1; k < cp.length - 1; k++) out.push(cp[k])
    }
  }
  return out
}

export class ChalkLine {
  constructor(src, opts = {}) {
    const {
      segments = 600,
      width = 0.05,
      minPx = 1.2,
      maxPx = 7,
      color = '#f1e7d4',
      headColor = '#ffe2b0',
      opacity = 1,
      seed = 1,
      dry = 1,
      taper = 0.6,
      fogColor = '#000000',
      fogDensity = 0,
    } = opts
    this.points = resample(src, segments)
    const n = this.points.length
    this.cum = [0]
    for (let i = 1; i < n; i++) this.cum.push(this.cum[i - 1] + this.points[i].distanceTo(this.points[i - 1]))
    this.length = this.cum[n - 1]

    const pos = new Float32Array(n * 2 * 3)
    const prev = new Float32Array(n * 2 * 3)
    const next = new Float32Array(n * 2 * 3)
    const side = new Float32Array(n * 2)
    const u = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      const p = this.points[i]
      const a = this.points[Math.max(0, i - 1)]
      const b = this.points[Math.min(n - 1, i + 1)]
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k
        pos.set([p.x, p.y, p.z], j * 3)
        prev.set([a.x, a.y, a.z], j * 3)
        next.set([b.x, b.y, b.z], j * 3)
        side[j] = k ? 1 : -1
        u[j] = this.cum[i] / this.length
      }
    }
    const idx = []
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('prev', new THREE.BufferAttribute(prev, 3))
    g.setAttribute('next', new THREE.BufferAttribute(next, 3))
    g.setAttribute('side', new THREE.BufferAttribute(side, 1))
    g.setAttribute('u', new THREE.BufferAttribute(u, 1))
    g.setIndex(idx)
    g.computeBoundingSphere()

    this.uniforms = {
      uRes: { value: new THREE.Vector2(1920, 1080) },
      uWidth: { value: width },
      uMinPx: { value: minPx },
      uMaxPx: { value: maxPx },
      uLen: { value: this.length },
      uHead: { value: 0 },
      uTail: { value: 0 },
      uTaper: { value: taper },
      uSeed: { value: seed * 1.37 },
      uBoil: { value: 0 },
      uDry: { value: dry },
      uColor: { value: new THREE.Color(color) },
      uHeadColor: { value: new THREE.Color(headColor) },
      uOpacity: { value: opacity },
      uFogColor: { value: new THREE.Color(fogColor) },
      uFogDensity: { value: fogDensity },
    }
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.mesh = new THREE.Mesh(g, this.material)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 2
  }

  get head() { return this.uniforms.uHead.value }
  set head(v) { this.uniforms.uHead.value = v }
  get tail() { return this.uniforms.uTail.value }
  set tail(v) { this.uniforms.uTail.value = v }
  get opacity() { return this.uniforms.uOpacity.value }
  set opacity(v) { this.uniforms.uOpacity.value = v }
  get width() { return this.uniforms.uWidth.value }
  set width(v) { this.uniforms.uWidth.value = v }

  /** Hand-drawn boil: re-seed the texture a few times a second while holding. */
  boil(time, rate = 7) {
    this.uniforms.uBoil.value = Math.floor(time * rate) * 0.71
  }

  /** Point at normalised arc length u. */
  pointAt(u, target = new THREE.Vector3()) {
    const d = Math.min(1, Math.max(0, u)) * this.length
    const c = this.cum
    let lo = 0
    let hi = c.length - 1
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1
      if (c[m] < d) lo = m
      else hi = m
    }
    const t = (d - c[lo]) / Math.max(1e-9, c[hi] - c[lo])
    return target.copy(this.points[lo]).lerp(this.points[hi], t)
  }

  /** Arc-length parameter of the point nearest to the given index fraction of the source corners. */
  uAtDistance(d) {
    return d / this.length
  }

  setFog(color, density) {
    this.uniforms.uFogColor.value.set(color)
    this.uniforms.uFogDensity.value = density
  }
}

/*
 * Chalk dust: shed by the drawing head. Each particle's spawn point is fixed along
 * the line; its age is derived from how far the head has travelled past it, so the
 * dust is a pure function of draw progress and survives seeking.
 */
const DUST_VERT = /* glsl */ `
attribute vec3 vel;
attribute float u0;
attribute float size;
uniform float uHead;
uniform float uTail;
uniform float uLen;
uniform float uSpeed;
uniform float uScale;
varying float vA;
void main(){
  float age = (uHead - u0) * uLen / uSpeed;
  float life = 1.4;
  vA = step(0.0, age) * (1.0 - smoothstep(0.1, life, age)) * smoothstep(0.0, 0.05, age);
  vA *= step(uTail, u0);
  vec3 p = position + vel * age + vec3(0.0, -0.18, 0.0) * age * age;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(-mv.z, 0.1);
}
`
const DUST_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vA;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.15, d) * vA * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}
`

export class ChalkDust {
  constructor(line, { count = 260, speed = 4, color = '#f1e7d4', opacity = 0.55, seed = 3 } = {}) {
    const r = rng(seed)
    const pos = new Float32Array(count * 3)
    const vel = new Float32Array(count * 3)
    const u0 = new Float32Array(count)
    const size = new Float32Array(count)
    const v = new THREE.Vector3()
    for (let i = 0; i < count; i++) {
      const u = (i + r()) / count
      line.pointAt(u, v)
      pos.set([v.x + (r() - 0.5) * 0.05, v.y + (r() - 0.5) * 0.05, v.z + (r() - 0.5) * 0.05], i * 3)
      vel.set([(r() - 0.5) * 0.22, (r() - 0.35) * 0.18, (r() - 0.5) * 0.22], i * 3)
      u0[i] = u
      size[i] = 0.9 + r() * 2.2
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('vel', new THREE.BufferAttribute(vel, 3))
    g.setAttribute('u0', new THREE.BufferAttribute(u0, 1))
    g.setAttribute('size', new THREE.BufferAttribute(size, 1))
    this.uniforms = {
      uHead: line.uniforms.uHead,
      uTail: line.uniforms.uTail,
      uLen: { value: line.length },
      uSpeed: { value: speed },
      uScale: { value: 34 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    }
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: DUST_VERT,
        fragmentShader: DUST_FRAG,
        transparent: true,
        depthWrite: false,
      }),
    )
    this.points.frustumCulled = false
    this.points.renderOrder = 3
  }
}

/*
 * Time-driven particle bursts (impact dust, chalk breaking into particles).
 * Each particle has an origin, velocity and birth time; uT is driven by the
 * timeline, so bursts replay and rewind exactly.
 */
const BURST_VERT = /* glsl */ `
attribute vec3 vel;
attribute float t0;
attribute float size;
uniform float uT;
uniform float uLife;
uniform float uGravity;
uniform float uDrag;
uniform float uScale;
varying float vA;
void main(){
  float age = uT - t0;
  vA = step(0.0, age) * (1.0 - smoothstep(uLife * 0.35, uLife, age));
  float k = (1.0 - exp(-uDrag * max(age, 0.0))) / uDrag;
  vec3 p = position + vel * k + vec3(0.0, uGravity, 0.0) * age * age * 0.5;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = size * uScale / max(-mv.z, 0.1);
}
`

export class Bursts {
  constructor({ capacity = 400, color = '#f1e7d4', opacity = 0.6, life = 1.2, gravity = -0.6, drag = 3.5 } = {}) {
    this.capacity = capacity
    this.n = 0
    const g = new THREE.BufferGeometry()
    this.pos = new Float32Array(capacity * 3)
    this.vel = new Float32Array(capacity * 3)
    this.t0 = new Float32Array(capacity).fill(1e6)
    this.size = new Float32Array(capacity)
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3))
    g.setAttribute('vel', new THREE.BufferAttribute(this.vel, 3))
    g.setAttribute('t0', new THREE.BufferAttribute(this.t0, 1))
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1))
    this.uniforms = {
      uT: { value: 0 },
      uLife: { value: life },
      uGravity: { value: gravity },
      uDrag: { value: drag },
      uScale: { value: 40 },
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: opacity },
    }
    this.points = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: BURST_VERT,
        fragmentShader: DUST_FRAG,
        transparent: true,
        depthWrite: false,
      }),
    )
    this.points.frustumCulled = false
    this.points.renderOrder = 3
  }

  /** Register a burst at time t (timeline seconds). Call during build only. */
  add(t, origin, { count = 24, speed = 1.2, up = 0.4, normal = new THREE.Vector3(0, 1, 0), size = 2.2, spread = 1, seed = 1 } = {}) {
    const r = rng(seed * 131 + Math.floor(t * 1000))
    const tangent = new THREE.Vector3(1, 0, 0)
    if (Math.abs(normal.x) > 0.9) tangent.set(0, 0, 1)
    const b1 = tangent.clone().cross(normal).normalize()
    const b2 = normal.clone().cross(b1).normalize()
    for (let i = 0; i < count && this.n < this.capacity; i++, this.n++) {
      const a = r() * Math.PI * 2
      const sp = speed * (0.35 + r() * 0.65)
      const v = b1.clone().multiplyScalar(Math.cos(a) * sp * spread).addScaledVector(b2, Math.sin(a) * sp * spread).addScaledVector(normal, up * (0.3 + r()))
      this.pos.set([origin.x, origin.y, origin.z], this.n * 3)
      this.vel.set([v.x, v.y, v.z], this.n * 3)
      this.t0[this.n] = t + r() * 0.02
      this.size[this.n] = size * (0.5 + r())
    }
    const g = this.points.geometry
    g.attributes.position.needsUpdate = true
    g.attributes.vel.needsUpdate = true
    g.attributes.t0.needsUpdate = true
    g.attributes.size.needsUpdate = true
  }
}

// ------------------------------------------------------------------ SVG chalk

let svgDefsReady = false

/** Install the shared SVG chalk filter once. */
export function ensureSvgChalk(svg) {
  if (svgDefsReady && svg.querySelector('#chalk-rough')) return
  const ns = 'http://www.w3.org/2000/svg'
  const defs = document.createElementNS(ns, 'defs')
  defs.innerHTML = `
    <filter id="chalk-rough" x="-5%" y="-40%" width="110%" height="180%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9 0.35" numOctaves="2" seed="4" result="n"/>
      <feDisplacementMap in="SourceGraphic" in2="n" scale="3.2" xChannelSelector="R" yChannelSelector="G" result="d"/>
      <feTurbulence type="fractalNoise" baseFrequency="1.6 0.25" numOctaves="1" seed="9" result="t"/>
      <feColorMatrix in="t" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -2.4 1.75" result="m"/>
      <feComposite in="d" in2="m" operator="in"/>
    </filter>`
  svg.prepend(defs)
  svgDefsReady = true
}

/** An SVG chalk stroke that draws itself via dash offset. Returns the element and a `draw` proxy for GSAP. */
export function svgChalkPath(parent, d, { width = 5, color = '#f1e7d4', opacity = 0.95 } = {}) {
  const ns = 'http://www.w3.org/2000/svg'
  const p = document.createElementNS(ns, 'path')
  p.setAttribute('d', d)
  p.setAttribute('fill', 'none')
  p.setAttribute('stroke', color)
  p.setAttribute('stroke-width', width)
  p.setAttribute('stroke-linecap', 'round')
  p.setAttribute('stroke-linejoin', 'round')
  p.setAttribute('opacity', opacity)
  p.setAttribute('filter', 'url(#chalk-rough)')
  parent.appendChild(p)
  const len = p.getTotalLength()
  p.style.strokeDasharray = `${len} ${len}`
  p.style.strokeDashoffset = `${len}`
  const proxy = {
    _v: 0,
    get v() {
      return this._v
    },
    set v(x) {
      this._v = x
      p.style.strokeDashoffset = `${len * (1 - x)}`
    },
  }
  return { el: p, draw: proxy, length: len }
}
