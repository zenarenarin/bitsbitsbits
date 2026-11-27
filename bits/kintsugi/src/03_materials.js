// Materials, procedural textures and the studio light environment.
let THREE = null; // set once three.js has been imported

// --- procedural glaze textures, generated into typed arrays (no canvas needed)
function makeGlazeTextures(surf, seed) {
  const def = surf.def;
  const W = 1024, H = 512, CW = 1024, CH = 512;
  const noise = makeNoise(seed + 501);
  const rng = makeRng(seed + 77);
  // coarse noise grids (cheap to upsample)
  const GW = 128, GH = 64;
  const g1 = new Float32Array(GW * GH), g2 = new Float32Array(GW * GH), g3 = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const u = i / GW, v = j / (GH - 1);
    g1[j * GW + i] = noise.cyl(u, v, 5.0, 4, 0.0);
    g2[j * GW + i] = noise.cyl(u, v, 11.0, 3, 3.3);
    g3[j * GW + i] = noise.cyl(u, v, 2.2, 2, 8.8);
  }
  const samp = (g, u, v) => {
    const x = (((u % 1) + 1) % 1) * GW, y = clamp01(v) * (GH - 1);
    const i0 = Math.floor(x), j0 = Math.min(GH - 2, Math.floor(y)), fx = x - i0, fy = y - j0;
    const i1 = (i0 + 1) % GW;
    return lerp(lerp(g[j0 * GW + (i0 % GW)], g[j0 * GW + i1], fx), lerp(g[(j0 + 1) * GW + (i0 % GW)], g[(j0 + 1) * GW + i1], fx), fy);
  };
  // where the foot is unglazed: lowest part of the outside
  let footV = 0;
  for (let k = 0; k <= 200; k++) { const v = k / 200; if (surf.prof(v)[1] < 0.012 && surf.prof(v)[0] > 0.02) footV = v; }
  footV = Math.min(footV + 0.012, 0.25);

  const outer = new Uint8Array(CW * CH * 4), inner = new Uint8Array(CW * CH * 4), rough = new Uint8Array(CW * CH * 4);
  const [gr, gg, gb] = def.glaze;
  for (let j = 0; j < CH; j++) {
    const v = j / (CH - 1);
    for (let i = 0; i < CW; i++) {
      const u = i / CW, o = (j * CW + i) * 4;
      const m = samp(g1, u, v), m2 = samp(g2, u, v), m3 = samp(g3, u, v);
      // glaze: soft mottling, a warmer breath where it ran thin, cooler where it pooled
      const val = 1 + m * 0.045 + m2 * 0.02;
      const warm = m3 * 0.02;
      const pool = smooth((0.22 - v) / 0.2) * 0.03; // thicker glaze near the foot
      let r = gr * val + warm - pool * 0.6, g = gg * val + warm * 0.4 - pool * 0.35, b = gb * val - warm * 0.5 - pool * 0.1;
      // unglazed foot ring outside: warm raw clay
      const foot = smooth((footV - v) / 0.015);
      const cr = 0.80 + m2 * 0.05, cg = 0.72 + m2 * 0.045, cb = 0.60 + m2 * 0.04;
      outer[o] = 255 * clamp01(lerp(r, cr, foot)); outer[o + 1] = 255 * clamp01(lerp(g, cg, foot)); outer[o + 2] = 255 * clamp01(lerp(b, cb, foot)); outer[o + 3] = 255;
      // inside: glaze pools in the well, slightly deeper and glossier
      const well = smooth((0.3 - v) / 0.3) * 0.05;
      inner[o] = 255 * clamp01(r - well * 0.9); inner[o + 1] = 255 * clamp01(g - well * 0.7); inner[o + 2] = 255 * clamp01(b - well * 0.35); inner[o + 3] = 255;
      // roughness (G channel is what three reads)
      const ro = clamp01(0.30 + m * 0.10 + m2 * 0.05 + foot * 0.5 - well * 0.8);
      rough[o] = rough[o + 1] = rough[o + 2] = 255 * ro; rough[o + 3] = 255;
    }
  }
  // iron specks and the odd pinhole
  const specks = Math.round(50 + def.speck * 260);
  for (let s = 0; s < specks; s++) {
    const cx = rng() * CW, cy = rng() * CH, rr = 0.35 + rng() * rng() * rng() * 1.6;
    const dark = rng() < 0.85;
    const col = dark ? [0.50 + rng() * 0.15, 0.40 + rng() * 0.1, 0.30] : [0.98, 0.97, 0.94];
    const a0 = dark ? 0.35 + rng() * 0.45 : 0.5;
    for (let y = Math.floor(cy - rr - 1); y <= cy + rr + 1; y++) for (let x = Math.floor(cx - rr - 1); x <= cx + rr + 1; x++) {
      if (y < 0 || y >= CH) continue;
      const d = Math.hypot(x - cx, y - cy);
      const a = a0 * clamp01(rr + 0.5 - d);
      if (a <= 0) continue;
      const xi = ((x % CW) + CW) % CW, o = (y * CW + xi) * 4;
      for (const arr of [outer, inner]) for (let c = 0; c < 3; c++) arr[o + c] = lerp(arr[o + c], col[c] * 255, a);
      rough[o + 1] = lerp(rough[o + 1], 200, a * 0.6);
    }
  }
  // bump: throwing rings, a slow wobble, and fine orange peel
  const bump = new Uint8Array(W * H * 4);
  const ringF = (surf.L * 7.5);
  for (let j = 0; j < H; j++) {
    const v = j / (H - 1);
    const ringAmp = def.rings * smooth((v - 0.08) / 0.15) * (0.55 + 0.45 * Math.sin(v * 9.3 + 1.1));
    for (let i = 0; i < W; i++) {
      const u = i / W;
      const wob = samp(g3, u, v) * 0.6;
      const ring = Math.sin(TAU * (v * ringF + wob * 0.35)) * 0.5 + Math.sin(TAU * (v * ringF * 2.3 + wob)) * 0.18;
      const peel = (hash2(i, j, seed) - 0.5) * 0.35 + (hash2(i >> 1, j >> 1, seed + 9) - 0.5) * 0.35;
      const h = 0.5 + ring * ringAmp * 0.34 + samp(g2, u, v) * 0.18 + peel * 0.10;
      const o = (j * W + i) * 4;
      bump[o] = bump[o + 1] = bump[o + 2] = 255 * clamp01(h); bump[o + 3] = 255;
    }
  }
  const mk = (data, w, h, srgb) => {
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true; t.anisotropy = 4;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { outer: mk(outer, CW, CH, true), inner: mk(inner, CW, CH, true), rough: mk(rough, CW, CH, false), bump: mk(bump, W, H, false) };
}
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function makeCeramicMaterials(tex) {
  const glazeCommon = {
    color: 0xffffff, roughnessMap: tex.rough, roughness: 1.0, metalness: 0,
    bumpMap: tex.bump, bumpScale: 0.55,
    clearcoat: 1.0, clearcoatRoughness: 0.075, envMapIntensity: 0.9,
    ior: 1.5, specularIntensity: 0.55
  };
  const outer = new THREE.MeshPhysicalMaterial(Object.assign({ map: tex.outer }, glazeCommon));
  const inner = new THREE.MeshPhysicalMaterial(Object.assign({ map: tex.inner }, glazeCommon, { clearcoatRoughness: 0.06 }));
  // broken body: unglazed, fine-grained, a touch whiter and drier than the glaze
  const bisque = new THREE.MeshStandardMaterial({ color: new THREE.Color().setRGB(0.86, 0.83, 0.77, THREE.SRGBColorSpace), roughness: 0.92, metalness: 0, bumpMap: tex.bump, bumpScale: 2.0, envMapIntensity: 0.55 });
  const rim = outer;
  return [outer, inner, bisque, rim];
}

// --- the studio: a dark room with large soft boxes, prefiltered for reflections
function buildEnvironment(renderer) {
  const scene = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'varying vec3 vP; void main(){ vec3 d = normalize(vP); float up = d.y*0.5+0.5; vec3 c = mix(vec3(0.010,0.009,0.008), vec3(0.040,0.036,0.031), smoothstep(0.2,1.0,up)); c += vec3(0.018,0.014,0.010)*smoothstep(0.55,0.0,up); gl_FragColor = vec4(c,1.0); }'
  }));
  scene.add(room);
  const box = (w, h, x, y, z, I, warm) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(I * warm[0], I * warm[1], I * warm[2]), side: THREE.DoubleSide }));
    m.position.set(x, y, z); m.lookAt(0, 0.4, 0);
    scene.add(m);
    return m;
  };
  // key: a big soft box high and to the left, in front
  box(5.0, 3.6, -5.2, 5.6, 4.2, 6.5, [1.0, 0.96, 0.9]);
  // strip on the right for a long vertical highlight
  box(1.1, 6.5, 6.6, 2.6, -0.6, 4.2, [1.0, 0.98, 0.95]);
  // top, faint
  box(5.0, 5.0, 0.0, 9.0, -1.0, 3.2, [1.0, 0.97, 0.92]);
  // tall strips behind on both sides: bright edges on the silhouette
  box(0.9, 7.0, -6.5, 2.5, -4.5, 3.4, [0.96, 0.97, 1.0]);
  box(0.9, 7.0, 6.0, 2.5, -5.0, 2.8, [1.0, 0.97, 0.94]);
  // back rim strip
  box(5.5, 0.9, 0.0, 2.0, -8.5, 2.6, [0.95, 0.95, 1.0]);
  // floor bounce, warm and very low
  box(8.0, 8.0, 0.0, -6.0, 2.0, 0.22, [1.0, 0.85, 0.65]);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(scene, 0.035);
  pm.dispose();
  scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  return rt.texture;
}

// --- gold: real metal, with a liquid-to-solid transition driven per sample
function makeGoldMaterial(shared) {
  const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.98, 0.72, 0.31), metalness: 1.0, roughness: 0.22, envMapIntensity: 2.4 });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.uniforms.uCure = shared.uCure;
    sh.uniforms.uFinalRough = shared.uFinalRough;
    sh.uniforms.uSettle = shared.uSettle;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFill; attribute float aAlong; attribute float aAcross; attribute float aSeed; attribute vec3 aBin;\nvarying float vFill; varying float vAlong; varying float vAcross; varying float vSeed; varying vec3 vBin;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFill = aFill; vAlong = aAlong; vAcross = aAcross; vSeed = aSeed; vBin = normalize(normalMatrix * aBin);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uCure; uniform float uFinalRough; uniform float uSettle;\nvarying float vFill; varying float vAlong; varying float vAcross; varying float vSeed; varying vec3 vBin;')
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\nif (vFill < 0.0) discard; float gAge = uTime - vFill; if (gAge < 0.0) discard;\nfloat gGrow = smoothstep(0.0, 0.16, gAge); if (abs(vAcross) > 0.15 + 0.85 * gGrow) discard;\nfloat gWet = (1.0 - smoothstep(0.0, uCure, gAge)) * (1.0 - uSettle);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(uFinalRough + (vSeed - 0.5) * 0.07, 0.11, gWet);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n{ float rip = sin(vAlong * 260.0 - gAge * 7.0 + vSeed * 6.0) * 0.5 + sin(vAlong * 610.0 + vAcross * 3.0 - gAge * 11.0) * 0.25; normal = normalize(normal + vBin * rip * 0.14 * gWet + vBin * (vSeed - 0.5) * 0.10); }')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 + (vSeed - 0.5) * 0.08 + gWet * 0.10;');
  };
  m.customProgramCacheKey = () => 'kintsugi-gold-v1';
  return m;
}

// A ghost outline for a fragment's place, and the travelling light on a snap.
function makeOutlineMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 }, uTime: { value: 0 }, uPulse: { value: -1 }, uColor: { value: new THREE.Color(1.0, 0.94, 0.84) } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    vertexShader: 'attribute float aS; attribute float aX; varying float vS; varying float vX; void main(){ vS = aS; vX = aX; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform float uOpacity; uniform float uTime; uniform float uPulse; uniform vec3 uColor; varying float vS; varying float vX;\nvoid main(){ float edge = 1.0 - smoothstep(0.35, 1.0, abs(vX)); float breathe = 0.72 + 0.28 * sin(uTime * 2.4); float a = uOpacity * breathe * edge;\n float d = abs(vS - uPulse); d = min(d, 1.0 - d); float p = uPulse < 0.0 ? 0.0 : exp(-d * d * 180.0) * 0.9 * edge;\n gl_FragColor = vec4(uColor * (a + p), 1.0); }'
  });
}

// Full-screen gallery void: near-black with a soft pool of light and grain.
function makeBackdrop() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: { uAspect: { value: 1 }, uCenter: { value: new THREE.Vector2(0.5, 0.45) }, uLight: { value: 1 }, uTime: { value: 0 } },
    depthWrite: false, depthTest: false,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }',
    fragmentShader: [
      'uniform float uAspect; uniform vec2 uCenter; uniform float uLight; uniform float uTime; varying vec2 vUv;',
      'float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }',
      'void main(){',
      ' vec2 p = vUv - uCenter; p.x *= uAspect;',
      ' float r = length(p * vec2(1.0, 1.25));',
      ' vec3 deep = vec3(0.0085, 0.0080, 0.0075);',
      ' vec3 lit = vec3(0.060, 0.054, 0.047);',
      ' float pool = exp(-r * r * 3.2) * uLight;',
      ' vec3 c = mix(deep, lit, pool);',
      ' float floorBand = smoothstep(0.12, -0.25, p.y) * exp(-p.x * p.x * 1.6) * 0.35 * uLight;',
      ' c += vec3(0.020, 0.018, 0.015) * floorBand;',
      ' c *= 1.0 - 0.35 * smoothstep(0.55, 1.3, length((vUv - 0.5) * vec2(uAspect, 1.0)));',
      ' c += (h(gl_FragCoord.xy + fract(uTime) * 17.0) - 0.5) * 0.0045;',
      ' gl_FragColor = vec4(c, 1.0);',
      '}'
    ].join('\n')
  }));
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}

// Soft radial texture for contact and lift shadows.
function makeSoftTexture() {
  const S = 64, d = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = (i + 0.5) / S * 2 - 1, y = (j + 0.5) / S * 2 - 1;
    const r = Math.min(1, Math.hypot(x, y));
    const a = Math.pow(1 - smooth(r), 1.6);
    const o = (j * S + i) * 4;
    d[o] = d[o + 1] = d[o + 2] = 0; d[o + 3] = 255 * a;
  }
  const t = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}
