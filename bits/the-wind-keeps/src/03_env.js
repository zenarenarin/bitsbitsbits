// The shared landscape kit: sky, ground, grass that answers the wind, clouds,
// silhouette layers, gust ribbons, leaves, birds and chimney smoke.
function createEnv(THREE, P) {
  const E = {};
  // One wind uniform block shared by grass and foliage. Up to four gust fronts:
  // (frontX, strength, direction, width).
  E.windU = { uTime: { value: 0 }, uG: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] }, uBase: { value: 0.25 } };
  const WIND_GLSL = `
    uniform float uTime; uniform vec4 uG[4]; uniform float uBase;
    float twkWind(vec3 w){
      float s = uBase * (0.6 + 0.4 * sin(uTime * 1.3 + w.x * 0.35 + w.z * 0.2)) * (0.7 + 0.3 * sin(uTime * 0.7 + w.x * 0.11));
      for (int i = 0; i < 4; i++) {
        vec4 g = uG[i];
        if (g.y > 0.001) { float d = (w.x - g.x) * g.z; s += g.z * g.y * exp(-d * d / (g.w * g.w)) * (d < 0.0 ? 1.0 : 0.35); }
      }
      return s;
    }`;
  E.WIND_GLSL = WIND_GLSL;

  E.sky = (c) => {
    const u = { top: { value: new THREE.Color(c.top) }, mid: { value: new THREE.Color(c.mid) }, hor: { value: new THREE.Color(c.horizon) }, sunDir: { value: new THREE.Vector3(...c.sunDir).normalize() }, sunCol: { value: new THREE.Color(c.sun) } };
    const m = new THREE.ShaderMaterial({
      uniforms: u, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top, mid, hor, sunCol; uniform vec3 sunDir; varying vec3 vD;
        void main(){ float h = vD.y; vec3 c = mix(hor, mid, smoothstep(-0.02, 0.18, h)); c = mix(c, top, smoothstep(0.18, 0.75, h));
          float s = max(dot(normalize(vD), sunDir), 0.0); c += sunCol * (pow(s, 24.0) * 0.35 + pow(s, 4.0) * 0.08);
          gl_FragColor = vec4(c, 1.0); }`
    });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), m);
    mesh.frustumCulled = false; mesh.renderOrder = -10;
    mesh.userData.u = u;
    return mesh;
  };

  // Ground: a gently rolling painted field. heightAt() is used to seat things.
  E.ground = (o) => {
    const size = o.size || 160, seg = o.seg || 90;
    const g = new THREE.PlaneGeometry(size, size, seg, seg); g.rotateX(-Math.PI / 2);
    const a = g.attributes.position, col = new Float32Array(a.count * 3), c = new THREE.Color(), c1 = new THREE.Color(o.grass), c2 = new THREE.Color(o.grass2), c3 = new THREE.Color(o.dry), cp = new THREE.Color(o.path || o.dry);
    const height = (x, z) => {
      const far = smooth((Math.hypot(x, z) - (o.flat || 12)) / 40);
      return (noise1(x * 0.05 + 3.1, 4) * 0.5 + noise1(z * 0.06 + 1.7, 5) * 0.5) * 2.2 * far + far * far * (o.rise || 6) * smooth((-z - 10) / 50) + (o.height ? o.height(x, z) : 0);
    };
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), z = a.getZ(i), y = height(x, z);
      a.setY(i, y);
      const n = noise1(x * 0.21 + z * 0.13, 7) * 0.5 + noise1(x * 0.07 - z * 0.11, 9) * 0.5;
      c.copy(c1).lerp(c2, smooth(n + 0.5)).lerp(c3, smooth((n - 0.2) * 3) * 0.5);
      if (o.pathAt) { const p = o.pathAt(x, z); if (p > 0) c.lerp(cp, p); }
      if (o.tint) o.tint(x, z, c);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, P.mat({ brush: 0.1, scale: 0.9 }));
    mesh.receiveShadow = true;
    mesh.userData.heightAt = height;
    return mesh;
  };

  // Grass: instanced blades bending under the shared wind field.
  E.grass = (o) => {
    const blade = new THREE.BufferGeometry();
    const w = 0.07, h = 1;
    blade.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-w, 0, 0, w, 0, 0, -w * 0.6, h * 0.5, 0, w * 0.6, h * 0.5, 0, 0, h, 0]), 3));
    blade.setAttribute('ty', new THREE.BufferAttribute(new Float32Array([0, 0, 0.5, 0.5, 1]), 1));
    blade.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4]);
    const n = o.count || 2600, rng = makeRng(o.seed || 11);
    const m = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { cRoot: { value: new THREE.Color(o.root) }, cTip: { value: new THREE.Color(o.tip) }, cTip2: { value: new THREE.Color(o.tip2 || o.tip) } }]),
      fog: true, side: THREE.DoubleSide,
      vertexShader: `attribute float ty; varying float vT; varying float vV; ${WIND_GLSL}
        #include <fog_pars_vertex>
        void main(){
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vec3 base = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
          float s = twkWind(base);
          float k = ty * ty;
          wp.x += s * k * 0.9; wp.y -= abs(s) * k * 0.35;
          wp.z += sin(uTime * 2.1 + base.x * 1.7) * 0.04 * k;
          vT = ty; vV = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `uniform vec3 cRoot, cTip, cTip2; varying float vT; varying float vV;
        #include <fog_pars_fragment>
        void main(){ vec3 tip = mix(cTip, cTip2, vV); vec3 c = mix(cRoot, tip, smoothstep(0.0, 1.0, vT)); gl_FragColor = vec4(c, 1.0);
          #include <fog_fragment>
        }`
    });
    m.uniforms.uTime = E.windU.uTime; m.uniforms.uG = E.windU.uG; m.uniforms.uBase = E.windU.uBase;
    const mesh = new THREE.InstancedMesh(blade, m, n);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), Pp = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let k = 0;
    for (let tries = 0; k < n && tries < n * 6; tries++) {
      const x = rng.range(o.x0, o.x1), z = rng.range(o.z0, o.z1);
      if (o.accept && !o.accept(x, z, rng)) continue;
      const y = o.heightAt ? o.heightAt(x, z) : 0;
      Q.setFromAxisAngle(up, rng() * TAU);
      const hh = rng.range(0.35, 0.8) * (o.scale || 1);
      S.set(rng.range(0.8, 1.4), hh, 1); Pp.set(x, y - 0.02, z);
      M.compose(Pp, Q, S); mesh.setMatrixAt(k++, M);
    }
    mesh.count = k;
    mesh.frustumCulled = false;
    return mesh;
  };

  // Wildflowers: tiny instanced heads scattered in the meadow, swaying with the grass.
  E.wildflowers = (o) => {
    const geo = new THREE.IcosahedronGeometry(0.07, 0);
    const mat = new THREE.MeshBasicMaterial({ fog: true });
    const n = o.count || 500, mesh = new THREE.InstancedMesh(geo, mat, n), rng = makeRng(o.seed || 3);
    const M = new THREE.Matrix4(), c = new THREE.Color(), cols = o.colors || [0xf6efd8, 0xf2c25a, 0xe58a72, 0xf6efd8, 0xd8cbe8];
    let k = 0;
    for (let tries = 0; k < n && tries < n * 8; tries++) {
      const x = rng.range(o.x0, o.x1), z = rng.range(o.z0, o.z1);
      if (o.accept && !o.accept(x, z, rng)) continue;
      const s = rng.range(0.7, 1.4);
      M.makeScale(s, s * 0.7, s).setPosition(x, (o.heightAt ? o.heightAt(x, z) : 0) + rng.range(0.15, 0.35), z);
      mesh.setMatrixAt(k, M); c.set(rng.pick(cols)); mesh.setColorAt(k, c); k++;
    }
    mesh.count = k;
    return mesh;
  };

  // Foliage material: painterly toon plus a vertex sway in the same wind.
  E.foliageMat = () => {
    const m = P.mat({ brush: 0.18, scale: 2.2 });
    const base = m.onBeforeCompile;
    m.onBeforeCompile = sh => {
      base(sh);
      sh.uniforms.uTime = E.windU.uTime; sh.uniforms.uG = E.windU.uG; sh.uniforms.uBase = E.windU.uBase;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\n' + WIND_GLSL)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          { vec3 w = (modelMatrix * vec4(transformed, 1.0)).xyz; float s = twkWind(w); float k = clamp((w.y - 0.6) / 5.0, 0.0, 1.0);
            transformed.x += s * k * 0.22 + sin(uTime * 1.7 + w.y * 1.3 + w.x) * 0.03 * k; transformed.z += cos(uTime * 1.3 + w.x * 0.8) * 0.02 * k; }`);
    };
    m.customProgramCacheKey = () => 'foliage';
    return m;
  };
  // A tree: trunk into builder `tb`, foliage blobs into builder `fb`.
  E.tree = (tb, fb, x, y, z, s = 1, seed = 1, cols = {}) => {
    const r = makeRng(seed);
    const lean = r.range(-0.12, 0.12);
    tb.add(new THREE.CylinderGeometry(0.12 * s, 0.22 * s, 2.6 * s, 6), cols.trunk || 0x7a5a44, { p: [x, y + 1.3 * s, z], r: [0, 0, lean] }, { shade: 0.3 });
    const n = 3 + (r() * 3 | 0);
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, d = r.range(0.2, 0.75) * s;
      const c = r.pick(cols.leaves || [0x8a9a5b, 0x7d9152, 0x9aa865, 0x6f8a55]);
      fb.add(P.blob(r.range(0.75, 1.15) * s, seed * 7 + i), c, { p: [x + Math.cos(a) * d - lean * 2.5 * s, y + 2.6 * s + r.range(-0.2, 0.7) * s, z + Math.sin(a) * d * 0.7] }, { shade: 0.35, top: cols.top || 0xc9c77a, topAmt: 0.45 });
    }
  };

  E.clouds = (o) => {
    const g = new THREE.Group(), list = [], rng = makeRng(o.seed || 5);
    const texs = [P.cloudTex(1), P.cloudTex(2), P.cloudTex(3), P.cloudTex(4)];
    for (let i = 0; i < (o.count || 9); i++) {
      const m = new THREE.SpriteMaterial({ map: texs[i % 4], transparent: true, depthWrite: false, fog: false, color: o.tint || 0xffffff, opacity: rng.range(0.85, 1) });
      const s = new THREE.Sprite(m);
      const d = rng.range(70, 170), sc = rng.range(22, 44) * d / 110;
      s.scale.set(sc, sc * 0.375, 1);
      s.position.set(rng.range(-55, 55) * d / 110, rng.range(o.y0 || 22, o.y1 || 60) * d / 110, -d);
      s.userData.v = rng.range(0.25, 0.6);
      g.add(s); list.push(s);
    }
    g.userData.update = (dt, boost = 0) => { for (const s of list) { s.position.x += s.userData.v * (1 + boost * 2) * dt; if (s.position.x > -s.position.z * 0.6) s.position.x = s.position.z * 0.6; } };
    return g;
  };

  // flat painted silhouettes, tinted toward the sky by distance
  E.layers = (defs) => {
    const g = new THREE.Group();
    for (const d of defs) {
      const tex = P.ridgeTex(d.seed, d.kind);
      const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, color: d.color, fog: false, depthWrite: false, alphaTest: 0.02 });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(d.w, d.w / 4), m);
      mesh.position.set(d.x || 0, d.y, d.z); mesh.renderOrder = -5 + (d.order || 0);
      g.add(mesh);
    }
    return g;
  };

  // Gust ribbons: a few pale strips that trace the gust's path near its front.
  E.ribbons = (scene) => {
    const R = { list: [] };
    const SEG = 34;
    function make(color, width) {
      const geo = new THREE.BufferGeometry();
      const pos = new Float32Array(SEG * 2 * 3), al = new Float32Array(SEG * 2);
      const sd = new Float32Array(SEG * 2);
      for (let i = 0; i < SEG; i++) { al[i * 2] = al[i * 2 + 1] = i / (SEG - 1); sd[i * 2] = 0; sd[i * 2 + 1] = 1; }
      const idx = []; for (let i = 0; i < SEG - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
      geo.setIndex(idx); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('al', new THREE.BufferAttribute(al, 1)); geo.setAttribute('side', new THREE.BufferAttribute(sd, 1));
      const m = new THREE.ShaderMaterial({
        uniforms: { col: { value: new THREE.Color(color) }, op: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
        vertexShader: 'attribute float al; attribute float side; varying float vA; varying float vS; void main(){ vA = al; vS = side; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 col; uniform float op; varying float vA; varying float vS; void main(){ float a = smoothstep(0.0, 0.7, vA) * (1.0 - smoothstep(0.95, 1.0, vA)); float core = 1.0 - abs(vS * 2.0 - 1.0); vec3 c = mix(col, vec3(1.0, 0.99, 0.95), smoothstep(0.55, 1.0, core) * 0.7); gl_FragColor = vec4(c, a * op * (0.35 + 0.65 * smoothstep(0.0, 0.6, core))); }'
      });
      const mesh = new THREE.Mesh(geo, m); mesh.frustumCulled = false; mesh.renderOrder = 5; mesh.visible = false;
      scene.add(mesh);
      return { mesh, pos, width, busy: false };
    }
    const pool = [];
    for (let i = 0; i < 12; i++) pool.push(make(0xffffff, 0.1));
    // gust: { curve, t0, t1, cross, alive }
    R.spawn = (gust, count = 3, color = 0xfff1c9) => {
      gust.ribbons = [];
      for (let i = 0; i < count; i++) {
        const r = pool.find(p => !p.busy); if (!r) break;
        r.busy = true; r.mesh.visible = true; r.mesh.material.uniforms.col.value.set(color);
        r.off = [(i - (count - 1) / 2) * 0.7 + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.8]; r.ph = Math.random() * 6; r.width = (i === Math.floor(count / 2) ? 0.2 : 0.11) + Math.random() * 0.06; r.len = 0.2 + Math.random() * 0.1;
        gust.ribbons.push(r);
      }
    };
    const _p = new THREE.Vector3(), _t = new THREE.Vector3(), _side = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
    // s: progress of the gust front along its curve, may exceed 1 (passing on)
    R.draw = (gust, s, fade, time) => {
      for (const r of gust.ribbons || []) {
        const op = clamp(fade) * 0.95;
        r.mesh.material.uniforms.op.value = op;
        for (let i = 0; i < SEG; i++) {
          const u = s - r.len * (1 - i / (SEG - 1)) * (1 + 0.3 * Math.sin(time + r.ph));
          const uc = clamp(u, 0, 1);
          gust.curve.getPointAt(uc, _p); gust.curve.getTangentAt(uc, _t);
          if (u > 1) _p.addScaledVector(_t, (u - 1) * gust.curve.getLength());
          _side.crossVectors(_t, _up).normalize();
          const wob = Math.sin(u * 22 + time * 3 + r.ph) * 0.18;
          _p.addScaledVector(_side, r.off[1] + wob * 0.5); _p.y += r.off[0] + wob;
          const wdt = r.width * Math.sin(Math.PI * clamp(i / (SEG - 1))) + 0.006;
          r.pos[i * 6] = _p.x; r.pos[i * 6 + 1] = _p.y + wdt; r.pos[i * 6 + 2] = _p.z;
          r.pos[i * 6 + 3] = _p.x; r.pos[i * 6 + 4] = _p.y - wdt; r.pos[i * 6 + 5] = _p.z;
        }
        r.mesh.geometry.attributes.position.needsUpdate = true;
      }
    };
    R.release = gust => { for (const r of gust.ribbons || []) { r.busy = false; r.mesh.visible = false; } gust.ribbons = []; };
    R.clear = () => { for (const r of pool) { r.busy = false; r.mesh.visible = false; } };
    return R;
  };

  // Leaves: small spinning quads, carried by gusts, settling afterwards.
  E.leaves = (scene, n = 70) => {
    const geo = new THREE.PlaneGeometry(0.26, 0.16);
    const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, vertexColors: false });
    const mesh = new THREE.InstancedMesh(geo, mat, n);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    const L = [], c = new THREE.Color(), cols = [0xc9b458, 0x9aa865, 0xd8a24a, 0x8a9a5b, 0xe0c27a];
    for (let i = 0; i < n; i++) { L.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), life: 0 }); c.set(cols[i % cols.length]); mesh.setColorAt(i, c); }
    mesh.frustumCulled = false; scene.add(mesh);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(1, 1, 1), Z = new THREE.Vector3(0, 0, 0);
    const api = {
      mesh,
      emit(p, v, count = 1, spread = 0.6) {
        for (let k = 0; k < count; k++) {
          const l = L.find(q => !q.on); if (!l) return;
          l.on = true; l.life = 0; l.p.set(p.x + (Math.random() - 0.5) * spread, p.y + (Math.random() - 0.5) * spread, p.z + (Math.random() - 0.5) * spread);
          l.v.set(v.x * (0.7 + Math.random() * 0.6), v.y + (Math.random() - 0.3) * 1.2, v.z + (Math.random() - 0.5) * 1.2);
          l.w.set(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4); l.r.set(Math.random() * 6, Math.random() * 6, 0);
        }
      },
      // swirl around a point (a caught gust)
      swirl(center, strength) { for (const l of L) if (l.on) { const dx = l.p.x - center.x, dy = l.p.y - center.y; const d2 = dx * dx + dy * dy; if (d2 < 30) { l.v.x += -dy * strength; l.v.y += dx * strength; } } },
      update(dt, windX) {
        for (let i = 0; i < n; i++) {
          const l = L[i];
          if (!l.on) { M.compose(Z, Q.identity(), Z); mesh.setMatrixAt(i, M); continue; }
          l.life += dt;
          l.v.y -= 1.1 * dt; l.v.x = damp(l.v.x, windX, 0.6, dt); l.v.z = damp(l.v.z, 0, 0.8, dt); l.v.y = Math.max(l.v.y, -1.4);
          l.p.addScaledVector(l.v, dt);
          l.r.x += l.w.x * dt; l.r.y += l.w.y * dt; l.r.z += l.w.z * dt;
          if (l.p.y < 0.03) { l.p.y = 0.03; l.v.multiplyScalar(0.5); l.w.multiplyScalar(0.9); }
          if (l.life > 7 || Math.abs(l.p.x) > 30) l.on = false;
          const fade = l.life > 6 ? 1 - (l.life - 6) : 1;
          Q.setFromEuler(l.r); S.setScalar(fade); M.compose(l.p, Q, S); mesh.setMatrixAt(i, M);
        }
        mesh.instanceMatrix.needsUpdate = true;
      },
      clear() { for (const l of L) l.on = false; }
    };
    return api;
  };

  // Birds: perch on things, take off when startled, circle, come back.
  E.birds = (scene, perches, color = 0x4b4f5c) => {
    const mat = new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: true });
    const body = new THREE.SphereGeometry(0.07, 6, 4); body.scale(1.6, 0.8, 0.9);
    const wing = new THREE.BufferGeometry(); wing.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.04, 0, 0, 0.05, 0.22, 0.02, 0.0]), 3)); wing.computeVertexNormals();
    const B = [];
    perches.forEach((p, i) => {
      const g = new THREE.Group(); const b = new THREE.Mesh(body, mat); g.add(b);
      const wl = new THREE.Mesh(wing, mat), wr = new THREE.Mesh(wing, mat); wr.scale.x = -1; g.add(wl, wr);
      g.position.set(...p); scene.add(g);
      B.push({ g, wl, wr, home: new THREE.Vector3(...p), st: 'perch', t: Math.random() * 5, ph: Math.random() * 6, c: new THREE.Vector3(), r: 0, h: 0, dir: i % 2 ? 1 : -1, hop: 0 });
    });
    const api = {
      list: B,
      startle(center, radius = 99) {
        for (const b of B) if (b.st === 'perch' && b.g.position.distanceTo(center) < radius) { b.st = 'up'; b.t = 0; b.c.set(b.home.x + b.dir * 2.5, b.home.y + 4 + Math.random() * 3, b.home.z - 2); b.r = 3 + Math.random() * 3; b.h = b.c.y; }
      },
      update(dt, time) {
        for (const b of B) {
          b.t += dt;
          if (b.st === 'perch') {
            b.g.position.lerp(b.home, 0.2);
            const peck = Math.sin(time * 1.3 + b.ph * 3) > 0.92 ? 0.25 : 0;
            b.g.rotation.set(peck, b.dir > 0 ? 0 : Math.PI, 0);
            b.wl.rotation.z = b.wr.rotation.z = 0.12;
          } else {
            const flap = Math.sin(time * 18 + b.ph) * 0.9;
            b.wl.rotation.z = flap; b.wr.rotation.z = -flap;
            const a = b.ph + b.t * 0.7 * b.dir;
            const target = new THREE.Vector3(b.c.x + Math.cos(a) * b.r, b.h + Math.sin(b.t * 1.3) * 0.5, b.c.z + Math.sin(a) * b.r * 0.5);
            if (b.st === 'up' && b.t > 7 + b.ph) b.st = 'home';
            if (b.st === 'home') { target.copy(b.home); if (b.g.position.distanceTo(b.home) < 0.08) { b.st = 'perch'; b.t = 0; } }
            const prev = b.g.position.clone();
            b.g.position.lerp(target, 1 - Math.exp(-(b.st === 'home' ? 1.6 : 1.1) * dt));
            const d = b.g.position.clone().sub(prev);
            if (d.lengthSq() > 1e-8) b.g.rotation.set(0, Math.atan2(-d.z, d.x), 0);
          }
        }
      }
    };
    return api;
  };

  // soft puffs drifting from a chimney or a vent
  E.smoke = (scene, P, origin, opts = {}) => {
    const mat = new THREE.SpriteMaterial({ map: P.dotTex, color: opts.color || 0xeeeae2, transparent: true, depthWrite: false, opacity: 0.5, fog: true });
    const S = [];
    for (let i = 0; i < (opts.count || 7); i++) { const s = new THREE.Sprite(mat.clone()); s.userData.t = i / (opts.count || 7); scene.add(s); S.push(s); }
    return { update(dt, wind = 0.3) { for (const s of S) { s.userData.t += dt / (opts.life || 5); if (s.userData.t > 1) s.userData.t -= 1; const t = s.userData.t; s.position.set(origin[0] + t * (1 + wind * 4), origin[1] + t * 3.2, origin[2]); const sc = 0.4 + t * 1.6; s.scale.set(sc, sc, 1); s.material.opacity = 0.45 * Math.sin(Math.PI * t); } } };
  };
  return E;
}
