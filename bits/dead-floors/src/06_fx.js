// Effects: pooled particles (blood, sparks, dust, smoke), tracers, beams, arcs, flashes.
const FX = { sys: [], tracers: null, beams: [], arcs: null, flashLight: null, boomLight: null, boomT: 0 };

function makeParticles(max, additive) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(max * 3), col = new Float32Array(max * 3), size = new Float32Array(max), alpha = new Float32Array(max);
  const attr = (a, n) => { const b = new THREE.BufferAttribute(a, n); b.setUsage(THREE.DynamicDrawUsage); return b; };
  geo.setAttribute('position', attr(pos, 3));
  geo.setAttribute('pcolor', attr(col, 3));
  geo.setAttribute('psize', attr(size, 1));
  geo.setAttribute('palpha', attr(alpha, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 }, map: { value: TEX.soft } },
    vertexShader: 'attribute vec3 pcolor; attribute float psize; attribute float palpha; varying vec3 vC; varying float vA; uniform float uScale;' +
      'void main(){ vC=pcolor; vA=palpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=psize*uScale/max(0.05,-mv.z); gl_Position=projectionMatrix*mv; float f=clamp((-mv.z-6.0)/22.0,0.0,1.0); vA*=1.0-f; }',
    fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ float a=texture2D(map,gl_PointCoord).a*vA; if(a<0.01) discard; gl_FragColor=vec4(vC,a); }',
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = additive ? 3 : 2;
  const s = { pts, geo, mat, max, pos, col, size, alpha, n: 0,
    vel: new Float32Array(max * 3), life: new Float32Array(max), maxLife: new Float32Array(max), grav: new Float32Array(max), drag: new Float32Array(max), grow: new Float32Array(max), a0: new Float32Array(max), next: 0 };
  scene.add(pts);
  FX.sys.push(s);
  return s;
}
function emit(s, x, y, z, vx, vy, vz, life, sz, r, g, b, grav = 0, drag = 0, grow = 0, a0 = 1) {
  let k;
  if (s.n < s.max) k = s.n++;
  else { k = s.next; s.next = (s.next + 1) % s.max; }
  s.pos[k * 3] = x; s.pos[k * 3 + 1] = y; s.pos[k * 3 + 2] = z;
  s.vel[k * 3] = vx; s.vel[k * 3 + 1] = vy; s.vel[k * 3 + 2] = vz;
  s.col[k * 3] = r; s.col[k * 3 + 1] = g; s.col[k * 3 + 2] = b;
  s.size[k] = sz; s.life[k] = life; s.maxLife[k] = life; s.grav[k] = grav; s.drag[k] = drag; s.grow[k] = grow; s.a0[k] = a0; s.alpha[k] = a0;
}
function updateParticles(dt) {
  for (const s of FX.sys) {
    let i = 0;
    while (i < s.n) {
      s.life[i] -= dt;
      if (s.life[i] <= 0) {
        const last = --s.n;
        if (i !== last) {
          for (let c = 0; c < 3; c++) { s.pos[i * 3 + c] = s.pos[last * 3 + c]; s.vel[i * 3 + c] = s.vel[last * 3 + c]; s.col[i * 3 + c] = s.col[last * 3 + c]; }
          s.size[i] = s.size[last]; s.life[i] = s.life[last]; s.maxLife[i] = s.maxLife[last]; s.grav[i] = s.grav[last]; s.drag[i] = s.drag[last]; s.grow[i] = s.grow[last]; s.a0[i] = s.a0[last];
        }
        continue;
      }
      const dk = Math.max(0, 1 - s.drag[i] * dt);
      s.vel[i * 3] *= dk; s.vel[i * 3 + 2] *= dk; s.vel[i * 3 + 1] = s.vel[i * 3 + 1] * dk - s.grav[i] * dt;
      s.pos[i * 3] += s.vel[i * 3] * dt; s.pos[i * 3 + 1] += s.vel[i * 3 + 1] * dt; s.pos[i * 3 + 2] += s.vel[i * 3 + 2] * dt;
      if (s.pos[i * 3 + 1] < 0.01) { s.pos[i * 3 + 1] = 0.01; s.vel[i * 3 + 1] *= -0.2; s.vel[i * 3] *= 0.5; s.vel[i * 3 + 2] *= 0.5; }
      s.size[i] += s.grow[i] * dt;
      const t = s.life[i] / s.maxLife[i];
      s.alpha[i] = s.a0[i] * Math.min(1, t * 2.5);
      i++;
    }
    s.next = Math.min(s.next, Math.max(0, s.n - 1));
    s.geo.setDrawRange(0, s.n);
    for (const a of ['position', 'pcolor', 'psize', 'palpha']) s.geo.attributes[a].needsUpdate = true;
  }
}
let PS_NORM = null, PS_ADD = null;

function initFX() {
  PS_NORM = makeParticles(700, false);
  PS_ADD = makeParticles(500, true);
  // Tracers: pooled line segments with fading vertex colours.
  const max = 48;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(max * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  scene.add(lines);
  FX.tracers = { lines, geo, max, list: [] };
  // Arcs (tesla) as another line pool.
  const ag = new THREE.BufferGeometry();
  ag.setAttribute('position', new THREE.BufferAttribute(new Float32Array(400 * 6), 3).setUsage(THREE.DynamicDrawUsage));
  const am = new THREE.LineBasicMaterial({ color: new THREE.Color(1.2, 1.6, 3), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const al = new THREE.LineSegments(ag, am); al.frustumCulled = false; scene.add(al);
  FX.arcs = { lines: al, geo: ag, list: [] };
  // Beam meshes for the railgun.
  FX.beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  FX.beamGeo.rotateX(Math.PI / 2);
  // Lights for gunfire and explosions.
  FX.flashLight = new THREE.PointLight(0xffc070, 0, 12, 2);
  scene.add(FX.flashLight);
  FX.boomLight = new THREE.PointLight(0xff7a30, 0, 16, 2);
  scene.add(FX.boomLight);
}

function addTracer(x0, y0, z0, x1, y1, z1, r = 1.4, g = 1.1, b = 0.6, life = 0.07) {
  const T = FX.tracers;
  if (T.list.length >= T.max) T.list.shift();
  T.list.push({ a: [x0, y0, z0], b: [x1, y1, z1], c: [r, g, b], life, max: life });
}
function addArc(x0, y0, z0, x1, y1, z1, life = 0.14) {
  const pts = [];
  const n = 8;
  for (let i = 0; i <= n; i++) {
    const t = i / n, j = (i === 0 || i === n) ? 0 : 0.35;
    pts.push([lerp(x0, x1, t) + rnd(-j, j), lerp(y0, y1, t) + rnd(-j, j), lerp(z0, z1, t) + rnd(-j, j)]);
  }
  FX.arcs.list.push({ pts, life });
}
function addBeam(x0, y0, z0, x1, y1, z1) {
  const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 1.8, 3), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
  const m = new THREE.Mesh(FX.beamGeo, mat);
  const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
  m.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  m.scale.set(0.035, 0.035, len);
  m.lookAt(x1, y1, z1);
  m.frustumCulled = false;
  scene.add(m);
  FX.beams.push({ m, life: 0.35 });
  for (let i = 0; i < 26; i++) { const t = Math.random(); emit(PS_ADD, lerp(x0, x1, t), lerp(y0, y1, t), lerp(z0, z1, t), rnd(-0.4, 0.4), rnd(-0.2, 0.6), rnd(-0.4, 0.4), 0.5, 0.06, 0.4, 0.9, 1.6, 0, 1); }
}
function updateLineFX(dt) {
  const T = FX.tracers;
  const P3 = T.geo.attributes.position.array, C3 = T.geo.attributes.color.array;
  let k = 0;
  for (let i = T.list.length - 1; i >= 0; i--) { const t = T.list[i]; t.life -= dt; if (t.life <= 0) T.list.splice(i, 1); }
  for (const t of T.list) {
    const f = t.life / t.max;
    P3.set(t.a, k * 6); P3.set(t.b, k * 6 + 3);
    C3[k * 6] = t.c[0] * f * 0.2; C3[k * 6 + 1] = t.c[1] * f * 0.2; C3[k * 6 + 2] = t.c[2] * f * 0.2;
    C3[k * 6 + 3] = t.c[0] * f; C3[k * 6 + 4] = t.c[1] * f; C3[k * 6 + 5] = t.c[2] * f;
    k++;
  }
  T.geo.setDrawRange(0, k * 2);
  T.geo.attributes.position.needsUpdate = true; T.geo.attributes.color.needsUpdate = true;
  const A = FX.arcs, AP = A.geo.attributes.position.array;
  let n = 0;
  for (let i = A.list.length - 1; i >= 0; i--) { A.list[i].life -= dt; if (A.list[i].life <= 0) A.list.splice(i, 1); }
  for (const a of A.list) {
    for (let i = 0; i < a.pts.length - 1 && n < 400; i++) { AP.set(a.pts[i], n * 6); AP.set(a.pts[i + 1], n * 6 + 3); n++; }
  }
  A.geo.setDrawRange(0, n * 2); A.geo.attributes.position.needsUpdate = true;
  for (let i = FX.beams.length - 1; i >= 0; i--) {
    const b = FX.beams[i]; b.life -= dt;
    b.m.material.opacity = Math.max(0, b.life / 0.35);
    b.m.scale.x = b.m.scale.y = 0.035 * (0.4 + b.life / 0.35);
    if (b.life <= 0) { scene.remove(b.m); b.m.material.dispose(); FX.beams.splice(i, 1); }
  }
  FX.flashLight.intensity = Math.max(0, FX.flashLight.intensity - dt * 900);
  FX.boomT = Math.max(0, FX.boomT - dt);
  FX.boomLight.intensity = FX.boomT > 0 ? 220 * (FX.boomT / 0.5) : 0;
}

function bloodBurst(x, y, z, dx, dy, dz, n = 12, big = 1) {
  for (let i = 0; i < n; i++) {
    const sp = rnd(1, 4) * big;
    const r = rnd(0.25, 0.45);
    emit(PS_NORM, x, y, z, dx * sp * 0.6 + rnd(-1.4, 1.4), dy * sp * 0.4 + rnd(-0.3, 2.2), dz * sp * 0.6 + rnd(-1.4, 1.4), rnd(0.35, 0.8), rnd(0.03, 0.09) * big, r, 0.015, 0.01, 9.8, 0.5, 0, 0.95);
  }
  for (let i = 0; i < 3; i++) emit(PS_NORM, x, y, z, rnd(-0.3, 0.3), rnd(-0.1, 0.4), rnd(-0.3, 0.3), rnd(0.4, 0.7), 0.14 * big, 0.3, 0.02, 0.015, 0, 2, 0.5, 0.55);
}
function wallImpact(x, y, z, nx, ny, nz, prop) {
  for (let i = 0; i < 5; i++) emit(PS_ADD, x, y, z, nx * rnd(1, 4) + rnd(-2, 2), ny * rnd(1, 4) + rnd(-1, 2.5), nz * rnd(1, 4) + rnd(-2, 2), rnd(0.12, 0.3), 0.025, 1.6, 0.9, 0.4, 9.8, 1);
  for (let i = 0; i < 3; i++) emit(PS_NORM, x + nx * 0.05, y + ny * 0.05, z + nz * 0.05, nx * rnd(0.3, 0.8) + rnd(-0.2, 0.2), ny * 0.4 + rnd(0, 0.4), nz * rnd(0.3, 0.8) + rnd(-0.2, 0.2), rnd(0.5, 0.9), 0.1, 0.42, 0.4, 0.36, -0.2, 1.5, 0.5, 0.5);
  if (!prop || ny !== 0) addDecal('hole', x, y, z, nx, ny, nz, 0.13, Math.random() * TAU);
}
function explosionFX(x, y, z, radius) {
  for (let i = 0; i < 46; i++) { const a = Math.random() * TAU, e = rnd(-0.3, 1), sp = rnd(2, 9) * radius / 3; emit(PS_ADD, x, y, z, Math.cos(a) * sp, e * sp * 0.7, Math.sin(a) * sp, rnd(0.25, 0.6), rnd(0.15, 0.4), 2.2, rnd(0.8, 1.2), 0.3, 2, 2, 1.2); }
  for (let i = 0; i < 18; i++) emit(PS_NORM, x + rnd(-0.5, 0.5), y + rnd(-0.3, 0.5), z + rnd(-0.5, 0.5), rnd(-1, 1), rnd(0.3, 1.5), rnd(-1, 1), rnd(0.9, 1.8), rnd(0.4, 0.8), 0.12, 0.11, 0.1, -0.3, 1.2, 1.4, 0.7);
  FX.boomLight.position.set(x, Math.max(0.5, y), z);
  FX.boomT = 0.5;
  addDecal('scorch', x, 0, z, 0, 1, 0, radius * 0.9, Math.random() * TAU);
}
