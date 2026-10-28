// =====================================================================
// Eyes. Each is built from: a socket set into the architecture, a ball
// that turns to the simulation's look direction, an iris drawn by shader,
// and two lids that open and close with the eye's state. Types differ in
// silhouette (socket, crest, hood, pupil shape) and in how they move, so
// they read even without colour.
// =====================================================================

const IRIS_VERT = `
varying vec3 vL; varying vec3 vW; varying vec3 vN;
void main(){ vL = position; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`;
const IRIS_FRAG = `
uniform vec3 uI1; uniform vec3 uI2; uniform float uPupil; uniform float uSlit; uniform float uDouble; uniform float uGlow; uniform float uCatch;
uniform float uDim; uniform float uRings; uniform float uR; uniform float uIrisR; uniform float uT; uniform float uStone; uniform float uSeed;
uniform vec3 uFogColor; uniform float uFogD; uniform vec3 uKey;
varying vec3 vL; varying vec3 vW; varying vec3 vN;
float n2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)) + uSeed) * 43758.5453); }
void main(){
  vec2 p = vL.xy / (uR * uIrisR);
  float r = length(p); float a = atan(p.y, p.x);
  if (vL.z < 0.0) discard;
  // sclera beyond the iris is drawn by the ball beneath: fade the cap out
  float irisMask = 1.0 - smoothstep(0.96, 1.0, r);
  if (irisMask <= 0.0) discard;
  float stri = 0.5 + 0.5 * sin(a * 38.0 + n2(vec2(floor(a * 12.0), 1.0)) * 6.0) * (0.6 + 0.4 * sin(r * 20.0 + a * 3.0));
  vec3 col = mix(uI1, uI2, smoothstep(0.15, 0.95, r));
  col *= 0.72 + 0.4 * stri;
  col = mix(col, col * 0.25, smoothstep(0.78, 0.97, r));          // dark limbal ring
  col += vec3(0.9, 0.6, 0.22) * uGlow * (0.5 + 0.5 * stri) * smoothstep(0.2, 0.7, r);
  if (uRings > 0.5) col *= 0.75 + 0.25 * step(0.5, fract(r * 5.0 - uT * 0.6));
  // pupil: round, slit, or doubled
  float pr = uPupil;
  vec2 q = p;
  float pd;
  if (uDouble > 0.5) { pd = min(length(q - vec2(-0.27, 0.0)) / (pr * 0.62), length(q - vec2(0.27, 0.0)) / (pr * 0.62)); }
  else { q.x /= mix(1.0, 0.28, uSlit); pd = length(q) / pr; }
  float pupil = 1.0 - smoothstep(0.92, 1.04, pd);
  col = mix(col, vec3(0.02, 0.018, 0.012), pupil);
  // lighting: a simple wet lambert so it sits in the scene
  vec3 N = normalize(vN);
  float l = 0.62 + 0.5 * max(dot(N, normalize(uKey)), 0.0);
  col *= l;
  col = mix(col, vec3(dot(col, vec3(0.3, 0.59, 0.11))) * 0.8, uDim);
  if (uStone > 0.5) col = mix(col, vec3(0.55, 0.52, 0.44) * l, 0.75);
  // the traveller's own light, caught in the eye that sees them
  float cl = 1.0 - smoothstep(0.05, 0.12, length(p - vec2(-0.28, 0.3)));
  col += vec3(1.0, 0.78, 0.42) * cl * uCatch * 1.6;
  float spec = 1.0 - smoothstep(0.02, 0.07, length(p - vec2(0.33, 0.36)));
  col += vec3(0.9) * spec * 0.35 * (1.0 - uStone);
  float dist = length(vW - cameraPosition);
  float f = 1.0 - exp(-pow(dist * uFogD, 1.35));
  col = mix(col, uFogColor, clamp(f, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

const EYE_LOOK = {
  watcher: { i1: '#8f9a48', i2: '#3d4520', pupil: 0.36, lidU: 0.62, lidL: 0.5, almond: 1.0, sclera: '#e2d6bb' },
  drifter: { i1: '#a39a58', i2: '#4a4424', pupil: 0.42, lidU: 0.55, lidL: 0.55, almond: 0.9, sclera: '#ddd1b4' },
  collector: { i1: '#b8963f', i2: '#4c3a14', pupil: 0.5, lidU: 0.6, lidL: 0.52, almond: 1.1, sclera: '#e0d3b4', double: 1 },
  sentinel: { i1: '#d29a42', i2: '#5c3c12', pupil: 0.42, lidU: 0.7, lidL: 0.42, almond: 1.2, sclera: '#ddcfae', slit: 1 },
  choir: { i1: '#cfc3a2', i2: '#5d5a44', pupil: 0.3, lidU: 0.58, lidL: 0.5, almond: 1.0, sclera: '#e6dbc2' },
  mimic: { i1: '#9aa77a', i2: '#39412a', pupil: 0.34, lidU: 0.6, lidL: 0.5, almond: 1.0, sclera: '#e2d7bd', rings: 1 },
  liar: { i1: '#8d9850', i2: '#383f1c', pupil: 0.36, lidU: 0.62, lidL: 0.5, almond: 0.95, sclera: '#dfd3b8' },
  falseeye: { i1: '#6b6650', i2: '#3b3829', pupil: 0.36, lidU: 0.62, lidL: 0.5, almond: 1.0, sclera: '#b5ab90', stone: 1 },
  unblinking: { i1: '#8c5b2a', i2: '#2a1a0c', pupil: 0.3, lidU: 0, lidL: 0, almond: 1, sclera: '#e9dcbf' },
  crown: { i1: '#9c8a44', i2: '#2f2810', pupil: 0.34, lidU: 0.62, lidL: 0.5, almond: 1.1, sclera: '#e6dbc1' },
  centre: { i1: '#b28b47', i2: '#1d150b', pupil: 0.28, lidU: 0.6, lidL: 0.5, almond: 1.15, sclera: '#ece2c8' }
};

const _eyeGeo = {};
function eyeGeos() {
  if (_eyeGeo.ball) return _eyeGeo;
  _eyeGeo.ball = ensureColor(new THREE.SphereGeometry(1, 28, 20));
  _eyeGeo.iris = new THREE.SphereGeometry(1.012, 32, 12, 0, TAU, 0, 0.62);
  _eyeGeo.iris.rotateX(Math.PI / 2); // cap around +z
  // lids: caps around +y (upper) and -y (lower) with a rolled rim
  const lid = (theta, sign) => {
    const g = new THREE.SphereGeometry(1.05, 30, 8, 0, Math.PI, Math.max(0, theta - 0.85), Math.min(theta, 0.85));
    const rim = new THREE.TorusGeometry(1.05 * Math.sin(theta), 0.05, 6, 40, Math.PI);
    rim.rotateX(-Math.PI / 2); rim.translate(0, 1.05 * Math.cos(theta), 0);
    const m = mergeGeos([ensureColor(g, 1), ensureColor(rim, 0.8)]);
    if (sign < 0) m.rotateX(Math.PI);
    return m;
  };
  _eyeGeo.lidU = lid(1.08, 1);
  _eyeGeo.lidL = lid(0.98, -1);
  // lashes along the front of each rim
  const lash = (theta, sign, n, len) => {
    const parts = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI * (0.12 + 0.76 * i / (n - 1)); // front half: around +z
      const R = 1.05 * Math.sin(theta), y = 1.05 * Math.cos(theta);
      const base = new THREE.Vector3(Math.cos(a) * R, y, Math.sin(a) * R);
      const out = base.clone().setY(0).normalize();
      const tip = base.clone().addScaledVector(out, len * (0.7 + 0.5 * Math.sin(i * 1.7) ** 2)).add(new THREE.Vector3(0, -len * 0.35, 0));
      const g = sweepGeo([base, base.clone().lerp(tip, 0.5).add(new THREE.Vector3(0, len * 0.12, 0)), tip], circleProfile(0.035, 4), t => 1 - t * 0.9);
      parts.push(g);
    }
    const m = mergeGeos(parts); if (sign < 0) m.rotateX(Math.PI); return m;
  };
  _eyeGeo.lashU = lash(1.08, 1, 13, 0.42);
  _eyeGeo.lashL = lash(0.98, -1, 9, 0.22);
  // socket: a raised, folded rim that the ball sits back inside
  const prof = [];
  const sp = [[0.99, 0.30], [1.03, 0.47], [1.16, 0.6], [1.34, 0.6], [1.56, 0.42], [1.78, 0.12], [1.95, -0.3], [1.9, -0.9], [1.4, -1.3], [0.6, -1.45], [0.02, -1.5]];
  for (const q of sp) prof.push(new THREE.Vector2(q[0], q[1]));
  const sock = new THREE.LatheGeometry(prof, 40);
  sock.rotateX(Math.PI / 2); // lathe axis y -> z
  // folds
  const fp = sock.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const x = fp.getX(i), y = fp.getY(i), z = fp.getZ(i), a = Math.atan2(y, x), r = Math.hypot(x, y);
    const k = 1 + 0.07 * Math.sin(a * 9) * clamp01((r - 1.3) / 0.8) + 0.04 * Math.sin(a * 4 + 1) * clamp01(r - 1.1);
    // almond: squeeze vertically, keep the inner lip round enough for the ball
    const sq = lerp(1.0, 0.82, clamp01((r - 1.05) / 1.2));
    fp.setX(i, x * k * 1.08); fp.setY(i, y * k * sq); fp.setZ(i, z + 0.08 * Math.sin(a * 9) * clamp01(r - 1.2));
  }
  sock.computeVertexNormals();
  _eyeGeo.socket = ensureColor(sock, 0.85);
  // pin stitches: a ring of short dark sutures
  const st = [];
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU, b = new THREE.BoxGeometry(0.07, 0.36, 0.07);
    b.rotateZ(a + 0.5); b.translate(Math.cos(a) * 1.5, Math.sin(a) * 1.38, 0.28); st.push(ensureColor(b));
  }
  _eyeGeo.stitch = mergeGeos(st);
  // crest for sentinels; hood for drifters; prongs for collectors; hooks for the lidless
  const crest = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.PI * (0.18 + 0.64 * i / 6), pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6, r = 1.9 + t * (1.4 + Math.sin(i * 1.3) * 0.4); pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, -0.3 - t * 0.6)); }
    crest.push(sweepGeo(pts, circleProfile(0.16, 6), t => 1 - t * 0.85));
  }
  _eyeGeo.crest = mergeGeos(crest);
  const hood = new THREE.SphereGeometry(1.55, 24, 12, 0, TAU, 0, 1.25);
  hood.rotateX(0.35); hood.translate(0, 0.15, -0.35);
  _eyeGeo.hood = ensureColor(hood, 0.8);
  const prongs = [];
  for (const s of [-1, 1]) for (let k = 0; k < 2; k++) {
    const pts = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(s * (1.7 + Math.sin(t * Math.PI) * 0.9), (k ? -1 : 1) * (0.4 + t * 1.3), -0.2 + t * 1.6)); }
    prongs.push(sweepGeo(pts, circleProfile(0.17, 6), t => 1 - t * 0.85));
  }
  _eyeGeo.prongs = mergeGeos(prongs);
  const hooks = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU, pts = [];
    for (let k = 0; k <= 6; k++) { const t = k / 6, r = 1.18 + t * 0.55; pts.push(new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r, 0.1 + t * 0.55 - t * t * 0.6)); }
    hooks.push(sweepGeo(pts, circleProfile(0.08, 5), t => 1 - t * 0.8));
  }
  _eyeGeo.hooks = mergeGeos(hooks);
  return _eyeGeo;
}

function buildEyeView(e, look) {
  const G = eyeGeos();
  const L = EYE_LOOK[e.type] || EYE_LOOK.watcher;
  const s = e.size;
  const root = new THREE.Group();
  root.position.fromArray(e.pos);
  const lidMat = e.type === 'falseeye' ? hatchMat('stone', { vc: true }) : hatchMat('lid', { vc: true });
  const sockMat = e.type === 'falseeye' ? hatchMat('stone', { vc: true, side: 2 }) : hatchMat(e.type === 'sentinel' || e.type === 'crown' ? 'ochre' : 'flesh', { vc: true, side: 2, color: e.type === 'choir' ? '#cdbf9d' : '#9a8564' });
  const scl = hatchMat('flesh', { vc: true, color: L.sclera, rim: 0.7 });
  const scale = new THREE.Group(); scale.scale.setScalar(s); root.add(scale);
  if (e.mount !== 'free') { const sock = new THREE.Mesh(G.socket, sockMat); sock.castShadow = true; scale.add(sock); }
  const ball = new THREE.Group(); scale.add(ball);
  const sclera = new THREE.Mesh(G.ball, scl); sclera.castShadow = true; ball.add(sclera);
  const irisMat = new THREE.ShaderMaterial({
    uniforms: Object.assign({
      uI1: { value: new THREE.Color(L.i1) }, uI2: { value: new THREE.Color(L.i2) }, uPupil: { value: L.pupil }, uSlit: { value: L.slit || 0 }, uDouble: { value: L.double || 0 },
      uGlow: { value: 0 }, uCatch: { value: 0 }, uDim: { value: 0 }, uRings: { value: L.rings || 0 }, uR: { value: 1.012 }, uIrisR: { value: Math.sin(0.62) },
      uT: GU.uTime, uStone: { value: L.stone || 0 }, uSeed: { value: (e.id.charCodeAt(0) * 0.37) % 7 }, uKey: { value: new THREE.Vector3(0.3, 0.8, 0.5) }
    }, { uFogColor: GU.uFogColor, uFogD: GU.uFogD }),
    vertexShader: IRIS_VERT, fragmentShader: IRIS_FRAG
  });
  const iris = new THREE.Mesh(G.iris, irisMat); ball.add(iris);
  const lids = new THREE.Group(); scale.add(lids);
  let lidU = null, lidL = null;
  if (L.lidU > 0) {
    lidU = new THREE.Group(); lidL = new THREE.Group();
    const mu = new THREE.Mesh(G.lidU, lidMat), ml = new THREE.Mesh(G.lidL, lidMat);
    mu.castShadow = true;
    const lashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(e.type === 'falseeye' ? '#4a463a' : '#120f0a') });
    lidU.add(mu, new THREE.Mesh(G.lashU, lashMat)); lidL.add(ml, new THREE.Mesh(G.lashL, lashMat));
    lids.add(lidU, lidL);
    lids.scale.set(L.almond, 1, 1);
  } else {
    const hk = new THREE.Mesh(G.hooks, hatchMat('ink', { vc: true })); scale.add(hk);
  }
  if (e.type === 'sentinel' || e.type === 'crown') scale.add(new THREE.Mesh(G.crest, hatchMat('bone', { vc: true })));
  if (e.type === 'drifter') { const h = new THREE.Mesh(G.hood, hatchMat('ink', { vc: true, side: 2 })); scale.add(h); }
  if (e.type === 'collector') scale.add(new THREE.Mesh(G.prongs, hatchMat('olive', { vc: true })));
  const stitch = new THREE.Mesh(G.stitch, new THREE.MeshBasicMaterial({ color: new THREE.Color('#0d0b07') }));
  stitch.visible = false; scale.add(stitch);
  // a soft amber halo that grows as the eye acquires (readable at phone scale)
  const halo = new THREE.Mesh(new THREE.RingGeometry(1.55, 2.25, 40), glowMat('#e7a548', { opacity: 0, side: THREE.DoubleSide }));
  halo.position.z = 0.4; scale.add(halo);
  const V = {
    e, root, scale, ball, iris, irisMat, lids, lidU, lidL, stitch, halo, L,
    open: e.state === 'dormant' ? 0 : 0.7, blinkT: 2 + Math.random() * 4, blink: 0, tremble: 0, lastState: e.state,
    _q: new THREE.Quaternion(), _v: new THREE.Vector3(), _z: new THREE.Vector3(0, 0, 1), _m: new THREE.Matrix4()
  };
  orientEye(V, true);
  return V;
}

function orientEye(V, force) {
  const e = V.e;
  V.root.position.fromArray(e.pos);
  V._v.fromArray(e.facing).normalize();
  V.root.quaternion.setFromUnitVectors(V._z, V._v);
}

// Map the simulation state to lids, pupil, glow. dt in seconds.
function updateEyeView(V, W, dt, ctx) {
  const e = V.e;
  if (e.rail || e.mover) orientEye(V);
  // ball direction: e.look expressed in the socket frame
  const inv = V._q.copy(V.root.quaternion).invert();
  const lk = V._v.fromArray(e.look).applyQuaternion(inv).normalize();
  const want = new THREE.Quaternion().setFromUnitVectors(V._z, lk);
  V.ball.quaternion.slerp(want, 1 - Math.exp(-dt * 18));
  const pitch = Math.asin(clamp(lk.y, -1, 1));
  const st = e.state, held = (W.observedBy[e.id] || []).length > 0;
  // openness target by state
  let open = 0.72;
  if (st === 'alert') open = 0.88;
  else if (st === 'acquiring') open = 0.98;
  else if (st === 'searching') open = 0.85;
  else if (st === 'pinned') open = 0.3;
  else if (st === 'releasing') open = e.st < 0.25 ? 0.05 : 0.6;
  else if (st === 'disrupted') open = 0.3 + 0.5 * Math.abs(Math.sin(e.st * 17));
  else if (st === 'dormant') open = 0.0;
  if (held && st === 'active') open = 0.6;
  if (e.type === 'liar' && !e.liarOpen) open = st === 'acquiring' ? 0.06 + 0.05 * Math.abs(Math.sin(W.t * 23)) : 0.02;
  if (e.type === 'falseeye') open = 0.72;
  // blinking: idle blinks, synchronised for a choir in formation
  if (e.type !== 'falseeye' && !e.unblink && st !== 'pinned' && st !== 'dormant') {
    if (e.type === 'choir' && e.group && groupSynced(W, e.group)) {
      const ph = (W.t % 4.2) / 4.2; V.blink = ph < 0.05 ? Math.sin(ph / 0.05 * Math.PI) : 0;
    } else {
      V.blinkT -= dt;
      if (V.blinkT <= 0) { V.blinkT = 2.5 + ((e.id.charCodeAt(0) * 7 + W.tick) % 50) / 10; V.blink = 1; }
      V.blink = Math.max(0, V.blink - dt * 7);
    }
    if (st === 'acquiring') V.blink = 0;
  } else V.blink = 0;
  const k = st === 'acquiring' || st === 'disrupted' ? 20 : 9;
  V.open = damp(V.open, open * (1 - Math.sin(V.blink * Math.PI * 0.5)), k, dt);
  if (V.lidU) {
    const tr = st === 'pinned' ? Math.sin(W.t * 31 + e.size) * 0.03 : 0;
    const follow = pitch * 0.45;
    // upper lid: 0 rad = fully open, ~0.95 rad = closed past centre
    V.lidU.rotation.x = lerp(1.0, 0.0, V.open) - follow * 0.8 + tr;
    V.lidL.rotation.x = -lerp(0.62, 0.0, V.open) - follow * 0.4 - tr;
  }
  // a liar's ball bulges under the closed lid and follows you
  if (e.type === 'liar' && V.lidU && !e.liarOpen) {
    const yaw = Math.atan2(lk.x, lk.z);
    V.lidU.rotation.y = yaw * 0.3; V.lidL.rotation.y = yaw * 0.3;
  } else if (V.lidU) { V.lidU.rotation.y = 0; V.lidL.rotation.y = 0; }
  // pupil: tightens as it acquires; dilates when pinned or held
  const U = V.irisMat.uniforms;
  let pupil = V.L.pupil;
  if (st === 'acquiring') pupil = lerp(V.L.pupil, V.L.pupil * 0.45, e.acq);
  if (st === 'pinned') pupil = V.L.pupil * 1.45;
  if (held && st === 'active') pupil = V.L.pupil * 1.25;
  if (e.type === 'falseeye') pupil = V.L.pupil;
  U.uPupil.value = damp(U.uPupil.value, pupil, 8, dt);
  U.uGlow.value = damp(U.uGlow.value, e.isFalse ? (st === 'acquiring' ? 0.5 : 0) : e.acq * 1.1 + (st === 'alert' ? 0.12 : 0), 10, dt);
  U.uCatch.value = damp(U.uCatch.value, e.seesPlayer && !e.isFalse ? 1 : 0, 14, dt);
  U.uDim.value = damp(U.uDim.value, st === 'pinned' ? 0.85 : st === 'dormant' ? 1 : 0, 8, dt);
  if (ctx && ctx.keyDir) U.uKey.value.copy(ctx.keyDir);
  V.stitch.visible = st === 'pinned';
  if (V.stitch.visible) { const sc = Math.min(1, e.st * 6); V.stitch.scale.setScalar(0.8 + 0.2 * sc); V.stitch.rotation.z = W.t * 0.2; }
  const ha = e.isFalse ? 0 : clamp01(e.acq * 1.2) * (0.35 + 0.25 * Math.sin(W.t * (6 + e.acq * 10)));
  V.halo.material.opacity = damp(V.halo.material.opacity, ha, 10, dt);
  V.halo.scale.setScalar(1.15 - 0.2 * e.acq);
  // a false eye, once looked at closely, shows the chisel marks: its lids stop pretending
  if (e.isFalse && e.revealed) U.uStone.value = 1;
}

// ---------------------------------------------------------------------
// Beams: lines of attention. One shared ribbon geometry, billboarded in
// the vertex shader; each beam has its own small material.
// ---------------------------------------------------------------------
let _beamGeo = null;
function beamGeo() {
  if (_beamGeo) return _beamGeo;
  const n = 32, pos = [], idx = [];
  for (let i = 0; i <= n; i++) { const t = i / n; pos.push(t, -1, 0, t, 1, 0); }
  for (let i = 0; i < n; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  _beamGeo = g; return g;
}
const BEAM_VERT = `
uniform vec3 uA; uniform vec3 uB; uniform float uW; uniform float uSag;
varying float vT; varying float vS; varying float vD;
void main(){
  float t = position.x; vT = t; vS = position.y;
  vec3 p = mix(uA, uB, t); p.y -= sin(t * 3.14159) * uSag;
  vec3 dir = normalize(uB - uA);
  vec3 toC = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toC));
  float w = uW * (0.55 + 0.45 * sin(t * 3.14159));
  p += side * position.y * w;
  vD = length(cameraPosition - p);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const BEAM_FRAG = `
uniform vec3 uC; uniform float uAlpha; uniform float uGrow; uniform float uT; uniform float uDash; uniform float uLen; uniform float uSpeed; uniform float uFogD;
varying float vT; varying float vS; varying float vD;
void main(){
  if (vT > uGrow) discard;
  float core = exp(-vS * vS * 9.0);
  float soft = exp(-vS * vS * 2.0) * 0.35;
  float motes = 0.55 + 0.45 * sin(vT * uLen * 1.7 - uT * uSpeed * 6.0);
  float dash = uDash > 0.5 ? step(0.45, fract(vT * uLen * 0.6 - uT * 0.8)) : 1.0;
  float head = smoothstep(uGrow - 0.06, uGrow, vT) * 1.5;
  float ends = smoothstep(0.0, 0.04, vT) * smoothstep(1.0, 0.96, vT);
  float a = (core + soft) * motes * dash * ends * uAlpha + head * core * uAlpha;
  a *= exp(-vD * uFogD * 0.5);
  gl_FragColor = vec4(uC * a, a);
#include <colorspace_fragment>
}`;
function makeBeam(color, width) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { uA: { value: new THREE.Vector3() }, uB: { value: new THREE.Vector3() }, uW: { value: width || 0.18 }, uSag: { value: 0 }, uC: { value: new THREE.Color(color) }, uAlpha: { value: 0 }, uGrow: { value: 1 }, uT: GU.uTime, uDash: { value: 0 }, uLen: { value: 10 }, uSpeed: { value: 1 }, uFogD: GU.uFogD },
    vertexShader: BEAM_VERT, fragmentShader: BEAM_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
  });
  const m = new THREE.Mesh(beamGeo(), mat); m.frustumCulled = false; m.visible = false; m.renderOrder = 5;
  return { m, mat, U: mat.uniforms, life: 0, key: null, a: 0 };
}
