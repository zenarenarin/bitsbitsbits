// =====================================================================
// Rendering core: the illustrated material and geometry builders.
//
// Every architectural surface uses one shader idea: light it properly
// (shadows, lamps), then turn darkness into ink. Shadowed and turned-away
// surfaces gather world-anchored hatching whose strokes thicken as light
// falls, a second direction crosses in, and grazing edges draw contours.
// Ink surfaces invert it: light etches pale lines into them.
// =====================================================================
let THREE = null;

const LOOKS = {
  act1: { bg: '#2a2c22', fog: '#4d4e3e', fogD: 0.0105, void: '#1b1c15', key: '#f3e6c8', keyI: 3.2, keyDir: [0.4, 0.8, 0.5], sky: '#a19e78', gnd: '#25221a', hemiI: 1.25, rim: '#c9b98e', haze: '#5c5b43', glow: '#d9b26a' },
  act2: { bg: '#1a1f17', fog: '#33402a', fogD: 0.012, void: '#121710', key: '#d9e0b8', keyI: 2.1, keyDir: [0.5, 0.78, 0.2], sky: '#6f7a4c', gnd: '#10130c', hemiI: 0.85, rim: '#aeb98a', haze: '#3f4a2c', glow: '#c9b064' },
  act3: { bg: '#18140f', fog: '#3a2d1c', fogD: 0.0125, void: '#150f09', key: '#e6c48a', keyI: 2.2, keyDir: [-0.7, 0.55, 0.3], sky: '#7a6440', gnd: '#120e09', hemiI: 0.8, rim: '#d2a75e', haze: '#4a3a24', glow: '#e0a64e' },
  act4: { bg: '#121210', fog: '#2c2c25', fogD: 0.0115, void: '#0d0d0b', key: '#f1ece0', keyI: 2.5, keyDir: [0.15, 0.95, 0.25], sky: '#7d7b6c', gnd: '#0d0d0b', hemiI: 0.75, rim: '#e8e0c8', haze: '#3a3a30', glow: '#e9c27c' }
};

// Material palette: base colour, ink colour, how strongly darkness turns to ink.
const MATS = {
  bone: { c: '#d3c6a4', ink: '#17140f', h: 0.8, freq: 1.6 },
  walk: { c: '#ddd0ae', ink: '#1a1712', h: 0.6, freq: 1.8 },
  olive: { c: '#6e6c3e', ink: '#14140b', h: 0.85, freq: 1.3 },
  moss: { c: '#5d6942', ink: '#11140b', h: 0.85, freq: 1.5 },
  ink: { c: '#2c2a23', ink: '#bfb08a', h: 0.28, freq: 1.2, invert: 1 },
  ochre: { c: '#a8843f', ink: '#1a1208', h: 0.85, freq: 1.8 },
  flesh: { c: '#b8a283', ink: '#2a2316', h: 0.8, freq: 4.0 },
  lid: { c: '#9c8566', ink: '#1e1910', h: 0.75, freq: 5.0 },
  stone: { c: '#a39a80', ink: '#1a1712', h: 0.95, freq: 6.0 },
  coat: { c: '#2a2822', ink: '#9a906f', h: 0.45, freq: 14.0, invert: 1 }
};

// Shared uniforms: occlusion fade around the traveller and the atmosphere.
const GU = {
  uPlayerScr: { value: null }, uPlayerDepth: { value: 30 }, uOccR: { value: 80 },
  uFogColor: { value: null }, uFogD: { value: 0.012 }, uVoid: { value: null }, uTime: { value: 0 },
  uRimColor: { value: null }
};
function initGfx() {
  GU.uPlayerScr.value = new THREE.Vector2(-999, -999);
  GU.uFogColor.value = new THREE.Color('#3a3b2c');
  GU.uVoid.value = new THREE.Color('#0b0c09');
  GU.uRimColor.value = new THREE.Color('#c9b98e');
}
function applyLookUniforms(L) {
  GU.uFogColor.value.set(L.fog); GU.uFogD.value = L.fogD; GU.uVoid.value.set(L.void); GU.uRimColor.value.set(L.rim);
}

const HATCH_VERT_PRE = `
varying vec3 vWPos; varying vec3 vWNrm; varying float vViewZ;
`;
const HATCH_VERT_POST = `
  vec4 hw = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    hw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif
  vWPos = hw.xyz;
  vec3 hn = objectNormal;
  #ifdef USE_INSTANCING
    hn = mat3(instanceMatrix) * hn;
  #endif
  vWNrm = normalize(mat3(modelMatrix) * hn);
  vViewZ = -mvPosition.z;
`;
const HATCH_FRAG_PRE = `
varying vec3 vWPos; varying vec3 vWNrm; varying float vViewZ;
uniform vec3 uInk; uniform float uHatch; uniform float uFreq; uniform float uInvert; uniform float uEtch; uniform vec3 uEtchC; uniform float uEtchDir;
uniform vec2 uPlayerScr; uniform float uPlayerDepth; uniform float uOccR; uniform float uOcc;
uniform vec3 uFogColor; uniform float uFogD; uniform vec3 uVoid; uniform vec3 uRimColor; uniform float uRim; uniform float uLift; uniform float uTime;
float hLines(float x, float thick) {
  float aa = fwidth(x) * 0.9 + 1e-4;
  float d = abs(fract(x) - 0.5);
  float m = 1.0 - smoothstep(thick * 0.5 - aa, thick * 0.5 + aa, d);
  return mix(m, thick, smoothstep(0.18, 0.5, aa));
}
float hNoise(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  float i = q.x + q.y * 4.0;
  float b = 0.0;
  if (i < 1.0) b = 0.0; else if (i < 2.0) b = 8.0; else if (i < 3.0) b = 2.0; else if (i < 4.0) b = 10.0;
  else if (i < 5.0) b = 12.0; else if (i < 6.0) b = 4.0; else if (i < 7.0) b = 14.0; else if (i < 8.0) b = 6.0;
  else if (i < 9.0) b = 3.0; else if (i < 10.0) b = 11.0; else if (i < 11.0) b = 1.0; else if (i < 12.0) b = 9.0;
  else if (i < 13.0) b = 15.0; else if (i < 14.0) b = 7.0; else if (i < 15.0) b = 13.0; else b = 5.0;
  return (b + 0.5) / 16.0;
}
`;
const HATCH_FRAG_MAIN = `
  {
    // occlusion: thin anything standing between the camera and the traveller
    if (uOcc > 0.5) {
      float sd = length(gl_FragCoord.xy - uPlayerScr);
      float inFront = step(vViewZ, uPlayerDepth - 2.5);
      float f = inFront * (1.0 - smoothstep(uOccR * 0.55, uOccR, sd));
      if (f > 0.0 && bayer4(gl_FragCoord.xy) < f * 0.82) discard;
    }
    vec3 N = normalize(vWNrm);
    vec3 V = normalize(cameraPosition - vWPos);
    vec3 an = abs(N);
    vec2 uv;
    if (an.y > an.x && an.y > an.z) uv = vWPos.xz; else if (an.x > an.z) uv = vWPos.zy; else uv = vWPos.xy;
    float wob = sin(uv.y * 1.7 + uv.x * 0.6) * 0.18 + sin(uv.x * 0.9 - uv.y * 2.3) * 0.08;
    float c1 = (uv.x * 0.7071 + uv.y * 0.7071) * uFreq + wob;
    float c2 = (uv.x * 0.7071 - uv.y * 0.7071) * uFreq * 1.12 - wob;
        vec3 base = max(diffuseColor.rgb, vec3(0.02));
    float lit = dot(outgoingLight, vec3(0.299, 0.587, 0.114)) / max(dot(base, vec3(0.299, 0.587, 0.114)), 0.03);
    float grain = hNoise(floor(vWPos.xz * 9.0) + floor(vWPos.y * 9.0)) * 0.12;
    float L = clamp(lit + grain - 0.06, 0.0, 2.0);
    float ink = 0.0;
    if (uInvert < 0.5) {
      // strokes: one dominant direction, broken into dashes of varying length
      float li = floor(c1);
      float hsh = fract(sin(li * 91.7 + 3.1) * 4375.85);
      float dash = step(0.22 + 0.25 * hsh, fract(c2 * 0.21 + hsh * 7.0));
      float t1 = mix(0.0, 0.55, smoothstep(0.66, 0.1, L));
      ink = max(ink, hLines(c1, t1) * mix(dash, 1.0, smoothstep(0.35, 0.1, L)));
      ink = max(ink, hLines(c2, mix(0.0, 0.4, smoothstep(0.2, 0.0, L))));
      float rim = 1.0 - abs(dot(N, V));
      ink = max(ink, smoothstep(0.78, 0.95, rim) * uRim);
      // engraved patterns on walkways (the spiral is in the ground you walk)
      if (uEtch > 0.5) {
        vec2 d = vWPos.xz - uEtchC.xz;
        float r = length(d);
        float e = 0.0;
        if (uEtch < 1.5) { float a = atan(d.y, d.x); e = hLines(r * 1.1 + a / 6.2831 * 3.0, 0.07); e = max(e, hLines(r * 0.55, 0.035) * 0.6); }
        else if (uEtch < 2.5) { vec2 dir = vec2(cos(uEtchDir), sin(uEtchDir)); e = hLines(dot(vWPos.xz, dir) * 0.9, 0.08); e = max(e, hLines(dot(vWPos.xz, vec2(-dir.y, dir.x)) * 0.35, 0.03) * 0.5); }
        else { float a = atan(d.y, d.x); e = hLines(a / 6.2831 * 48.0, 0.06) * smoothstep(0.5, 2.0, r); e = max(e, hLines(r * 0.7, 0.05)); }
        ink = max(ink, e * 0.55 * step(0.5, an.y));
      }
      outgoingLight = mix(outgoingLight, uInk * (0.6 + 0.4 * L), clamp(ink * uHatch, 0.0, 1.0));
    } else {
      // ink surfaces: the light engraves pale strokes into them
      float e = max(hLines(c1, mix(0.0, 0.3, smoothstep(0.3, 1.2, L))), hLines(c2, mix(0.0, 0.22, smoothstep(0.8, 1.5, L))));
      float rim = 1.0 - abs(dot(N, V));
      e = max(e, smoothstep(0.78, 0.97, rim) * uRim * 0.6);
      outgoingLight = mix(outgoingLight, uInk * clamp(L, 0.25, 1.1), clamp(e * uHatch, 0.0, 1.0));
    }
    outgoingLight += uRimColor * pow(1.0 - abs(dot(N, V)), 4.0) * 0.05 * uLift;
  }
`;
const HATCH_FOG = `
  {
    float dist = length(vWPos - cameraPosition);
    float f = 1.0 - exp(-pow(dist * uFogD, 1.35));
    float below = clamp(-vWPos.y / 45.0, 0.0, 1.0);
    vec3 fc = mix(uFogColor, uVoid, smoothstep(0.0, 1.0, below));
    f = max(f, smoothstep(0.0, 1.0, below) * 0.85);
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fc, clamp(f, 0.0, 1.0));
  }
`;

const _matCache = {};
// opts: { kind, occ (fade in front of traveller), etch: 0..3, etchC, etchDir, side, vc (vertex colours), color }
function hatchMat(kind, opts) {
  opts = opts || {};
  const key = kind + '|' + (opts.occ ? 1 : 0) + '|' + (opts.etch || 0) + '|' + (opts.etchC ? opts.etchC.join(',') : '') + '|' + (opts.etchDir || 0) + '|' + (opts.side || 0) + '|' + (opts.vc ? 1 : 0) + '|' + (opts.color || '') + '|' + (opts.rim === undefined ? '' : opts.rim) + '|' + (opts.emissive || '');
  if (_matCache[key] && !opts.unique) return _matCache[key];
  const M = MATS[kind] || MATS.bone;
  const mat = new THREE.MeshLambertMaterial({ color: new THREE.Color(opts.color || M.c), vertexColors: !!opts.vc, side: opts.side === 2 ? THREE.DoubleSide : opts.side === 1 ? THREE.BackSide : THREE.FrontSide });
  if (opts.emissive) mat.emissive = new THREE.Color(opts.emissive);
  const U = {
    uInk: { value: new THREE.Color(M.ink) }, uHatch: { value: M.h }, uFreq: { value: opts.freq || M.freq }, uInvert: { value: M.invert || 0 },
    uEtch: { value: opts.etch || 0 }, uEtchC: { value: new THREE.Vector3().fromArray(opts.etchC || [0, 0, 0]) }, uEtchDir: { value: opts.etchDir || 0 },
    uOcc: { value: opts.occ ? 1 : 0 }, uRim: { value: opts.rim === undefined ? 0.85 : opts.rim }, uLift: { value: 1 }
  };
  mat.userData.U = U;
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, GU);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + HATCH_VERT_PRE)
      .replace('#include <fog_vertex>', '#include <fog_vertex>\n' + HATCH_VERT_POST);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + HATCH_FRAG_PRE)
      .replace('#include <opaque_fragment>', HATCH_FRAG_MAIN + '\n#include <opaque_fragment>')
      .replace('#include <fog_fragment>', HATCH_FOG);
  };
  mat.customProgramCacheKey = () => 'hatch';
  if (!opts.unique) _matCache[key] = mat;
  return mat;
}
// Unlit atmospheric material (haze cards, distant massing): fogged flat colour with a soft vertical gradient.
function hazeMat(color, opts) {
  opts = opts || {};
  return new THREE.ShaderMaterial({
    uniforms: Object.assign({ uC: { value: new THREE.Color(color) }, uA: { value: opts.alpha === undefined ? 1 : opts.alpha } }, GU),
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); #ifdef USE_INSTANCING\n w = modelMatrix * instanceMatrix * vec4(position,1.0);\n#endif\n vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }'.replace(' #ifdef', '\n#ifdef'),
    fragmentShader: `uniform vec3 uC; uniform float uA; uniform vec3 uFogColor; uniform float uFogD; uniform vec3 uVoid; varying vec3 vW;
      void main(){ float dist = length(vW - cameraPosition); float f = 1.0 - exp(-pow(dist * uFogD, 1.25));
        float below = clamp(-vW.y / 60.0, 0.0, 1.0); vec3 fc = mix(uFogColor, uVoid, below);
        vec3 c = mix(uC, fc, clamp(f * 0.92 + below * 0.5, 0.0, 1.0)); gl_FragColor = vec4(c, uA);\n#include <tonemapping_fragment>\n#include <colorspace_fragment>\n}`,
    transparent: opts.alpha !== undefined && opts.alpha < 1, depthWrite: opts.depthWrite !== false, side: opts.side || THREE.FrontSide
  });
}
function glowMat(color, opts) {
  opts = opts || {};
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: opts.opacity === undefined ? 1 : opts.opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: opts.side || THREE.FrontSide, fog: false });
}

// ---------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------
// Sweep a closed 2D profile (array of [x,y]) along a path of THREE.Vector3.
// scale(t) scales the profile along the path; returns BufferGeometry with AO-ish vertex colours.
function sweepGeo(path, profile, scale, opts) {
  opts = opts || {};
  const n = path.length, m = profile.length;
  const pos = [], nrm = [], col = [], idx = [];
  const T = [], Nn = [], Bn = [];
  for (let i = 0; i < n; i++) {
    const a = path[Math.max(0, i - 1)], b = path[Math.min(n - 1, i + 1)];
    T.push(new THREE.Vector3().subVectors(b, a).normalize());
  }
  // parallel transport frames
  let up = opts.up ? opts.up.clone() : new THREE.Vector3(0, 1, 0);
  if (Math.abs(T[0].dot(up)) > 0.95) up = new THREE.Vector3(1, 0, 0);
  let N0 = new THREE.Vector3().crossVectors(T[0], up).normalize();
  let B0 = new THREE.Vector3().crossVectors(N0, T[0]).normalize();
  Nn.push(N0); Bn.push(B0);
  for (let i = 1; i < n; i++) {
    const axis = new THREE.Vector3().crossVectors(T[i - 1], T[i]);
    let Ni = Nn[i - 1].clone();
    if (axis.length() > 1e-6) { axis.normalize(); const ang = Math.acos(clamp(T[i - 1].dot(T[i]), -1, 1)); Ni.applyAxisAngle(axis, ang); }
    Nn.push(Ni); Bn.push(new THREE.Vector3().crossVectors(Ni, T[i]).normalize());
  }
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) : 0, s = scale ? scale(t, i) : 1;
    const sx = Array.isArray(s) ? s[0] : s, sy = Array.isArray(s) ? s[1] : s;
    for (let j = 0; j < m; j++) {
      const px = profile[j][0] * sx, py = profile[j][1] * sy;
      const v = path[i].clone().addScaledVector(Nn[i], px).addScaledVector(Bn[i], py);
      pos.push(v.x, v.y, v.z);
      const nn = Nn[i].clone().multiplyScalar(px).addScaledVector(Bn[i], py).normalize();
      nrm.push(nn.x, nn.y, nn.z);
      const ao = opts.ao ? opts.ao(t, j / m, v) : 1;
      col.push(ao, ao, ao);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + (j + 1) % m, c = (i + 1) * m + j, d = (i + 1) * m + (j + 1) % m;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  if (opts.recompute !== false) g.computeVertexNormals();
  return g;
}
function circleProfile(r, n, ridges, ridgeAmt, flatten) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = i / n * TAU;
    const rr = r * (1 + (ridges ? Math.pow(Math.abs(Math.cos(a * ridges / 2)), 6) * ridgeAmt : 0));
    out.push([Math.cos(a) * rr, Math.sin(a) * rr * (flatten || 1)]);
  }
  return out;
}

// A revolved column: profile(t) gives radius multiplier along height, flutes carve the surface.
function columnGeo(r, y0, y1, o) {
  o = o || {};
  const radial = o.radial || 28, rows = o.rows || Math.max(8, Math.min(70, Math.round((y1 - y0) / 1.2)));
  const flutes = o.flutes === undefined ? 12 : o.flutes, fd = o.fluteDepth === undefined ? 0.08 : o.fluteDepth;
  const rng = makeRng(o.seed || 3);
  const bands = [];
  for (let i = 0; i < (o.bands || 4); i++) bands.push(rng.range(0.1, 0.95));
  const pos = [], col = [], idx = [];
  for (let i = 0; i <= rows; i++) {
    const t = i / rows, y = lerp(y0, y1, t);
    let pr = o.profile ? o.profile(t, y) : 1;
    for (const b of bands) { const d = (t - b) * (y1 - y0); pr += 0.13 * Math.exp(-d * d / 0.35) - 0.05 * Math.exp(-d * d / 3); }
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * TAU;
      const fl = flutes ? Math.pow(Math.abs(Math.cos(a * flutes / 2)), 0.6) : 1;
      const twist = o.twist ? Math.sin(t * 7 + a * 3) * o.twist : 0;
      const rr = r * pr * (1 - fd + fd * fl + twist);
      pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
      const ao = (0.55 + 0.45 * fl) * (0.7 + 0.3 * smooth((y - y0) / Math.max(1, (y1 - y0) * 0.25)));
      col.push(ao, ao, ao);
    }
  }
  for (let i = 0; i < rows; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + 1, c = a + radial + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}

// Annular sector slab: top at y, thickness down. ridges on the underside are separate.
function arcSlabGeo(r0, r1, a0, a1, y, thick, o) {
  o = o || {};
  const span = a1 - a0, segs = Math.max(6, Math.ceil(Math.abs(span) * Math.max(r1, 2) / 1.0));
  const pos = [], col = [], idx = [];
  const bev = Math.min(0.25, thick * 0.3);
  // cross-section (r, y) loop: top inner -> top outer -> outer side -> bottom outer -> bottom inner -> inner side
  const sec = [];
  if (r0 > 0.01) sec.push([r0 + bev, y], [r1 - bev, y], [r1, y - bev], [r1 - bev * 0.5, y - thick], [r0 + bev * 0.5, y - thick], [r0, y - bev]);
  else sec.push([0, y], [r1 - bev, y], [r1, y - bev], [r1 * 0.96, y - thick], [0, y - thick]);
  const ns = sec.length, closed = r0 > 0.01;
  for (let i = 0; i <= segs; i++) {
    const a = a0 + span * i / segs, c = Math.cos(a), s = Math.sin(a);
    for (let k = 0; k < ns; k++) {
      // duplicate verts per facet edge for crisp normals: emit each section point twice
      const p = sec[k];
      pos.push(c * p[0], p[1], s * p[0]); const ao = p[1] < y - 0.01 ? 0.55 : 1; col.push(ao, ao, ao);
    }
  }
  const nk = closed ? ns : ns - 1;
  for (let i = 0; i < segs; i++) for (let k = 0; k < nk; k++) {
    const a = i * ns + k, b = i * ns + (k + 1) % ns, c2 = (i + 1) * ns + k, d = (i + 1) * ns + (k + 1) % ns;
    idx.push(a, c2, b, b, c2, d);
  }
  // end caps for partial arcs
  if (Math.abs(span) < TAU - 1e-3) {
    for (const end of [0, segs]) {
      const base = end * ns;
      for (let k = 1; k < ns - 1; k++) { if (end === 0) idx.push(base, base + k, base + k + 1); else idx.push(base, base + k + 1, base + k); }
    }
  }
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g = g.toNonIndexed(); g.computeVertexNormals();
  return g;
}
// Rectangular slab with bevelled top edge; centred, length along local +x... we build along z and rotate.
function slabGeo(w, l, thick, rise) {
  const g = new THREE.BoxGeometry(w, thick, l, Math.max(1, Math.round(w / 1.5)), 1, Math.max(1, Math.round(l / 1.5)));
  g.translate(0, -thick / 2, 0);
  const p = g.attributes.position, col = [];
  for (let i = 0; i < p.count; i++) {
    let y = p.getY(i);
    const ao = y < -0.01 ? 0.55 : 1; col.push(ao, ao, ao);
    if (rise) { const t = (p.getZ(i) / l) + 0.5; p.setY(i, y + rise * t); }
    // chamfer the top edges a touch
    if (y > -0.01) { const ex = Math.abs(p.getX(i)) > w / 2 - 0.01, ez = Math.abs(p.getZ(i)) > l / 2 - 0.01; if (ex || ez) p.setY(i, p.getY(i) - 0.12); }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// Tapered keel hanging beneath a slab: a box whose bottom shrinks and sags.
function keelGeo(w, l, depth, seed) {
  const g = new THREE.BoxGeometry(w * 0.86, depth, l * 0.92, 2, 4, Math.max(2, Math.round(l / 2)));
  g.translate(0, -depth / 2, 0);
  const p = g.attributes.position, rng = makeRng(seed || 5), col = [];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i), t = clamp01(-y / depth);
    const k = 1 - 0.85 * Math.pow(t, 0.8);
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * (1 - 0.35 * t));
    p.setY(i, y - Math.sin(p.getZ(i) * 0.7 + seed) * 0.4 * t);
    const ao = 0.5 * (1 - t) + 0.15; col.push(ao, ao, ao);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}
// Merge BufferGeometries that share attributes position/normal/color (non-indexed output).
function mergeGeos(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  let total = 0; for (const g of parts) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    if (!g.attributes.normal) g.computeVertexNormals();
    nrm.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    if (g.attributes.color) col.set(g.attributes.color.array.subarray(0, n * 3), o * 3); else col.fill(1, o * 3, (o + n) * 3);
    o += n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}
function ensureColor(g, v) {
  if (g.attributes.color) return g;
  const n = g.attributes.position.count, a = new Float32Array(n * 3).fill(v === undefined ? 1 : v);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
function bakeXf(g, x, y, z, ry, sx, sy, sz, rx, rz) {
  const m = new THREE.Matrix4();
  m.compose(new THREE.Vector3(x || 0, y || 0, z || 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')), new THREE.Vector3(sx || 1, sy || sx || 1, sz || sx || 1));
  g.applyMatrix4(m); return g;
}
// three's rotation.y for a simulation yaw (atan2(z, x) convention)
const threeYaw = yaw => -yaw;
