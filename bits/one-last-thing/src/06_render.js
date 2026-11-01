// Rendering: painterly materials, inked outlines, geometry built from the same features
// as the collision parts, the drawer, the presentation tray and the two cameras.

function createView(THREE, canvas, opts) {
  const { noise3, rng, clamp, lerp } = U;
  const lowPower = !!opts.lowPower;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(opts.dpr || 1, lowPower ? 1.5 : 2));
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;

  const scene = new THREE.Scene(), trayScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
  const trayCam = new THREE.OrthographicCamera(-10, 10, 5, -5, 0.1, 200);

  // ---- lights: warm key from upper left, cool fill, warm bounce ----
  const hemi = new THREE.HemisphereLight(0xfff0d8, 0x7a5a44, 1.25); scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffe0b4, 2.1);
  key.position.set(-18, 34, 22); key.castShadow = true;
  key.shadow.mapSize.set(lowPower ? 1024 : 2048, lowPower ? 1024 : 2048);
  key.shadow.radius = 4; key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
  scene.add(key); scene.add(key.target);
  const fill = new THREE.DirectionalLight(0x9fb8cc, 0.45); fill.position.set(24, 10, -6); scene.add(fill);
  const tHemi = new THREE.HemisphereLight(0xfff0d8, 0x7a5a44, 1.35); trayScene.add(tHemi);
  const tKey = new THREE.DirectionalLight(0xffe0b4, 1.9); tKey.position.set(-10, 20, 18); trayScene.add(tKey);
  const tFill = new THREE.DirectionalLight(0x9fb8cc, 0.4); tFill.position.set(14, 6, -4); trayScene.add(tFill);

  // ground that only shows shadows (the page is painted paper behind the canvas)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ color: 0x4a2e1e, opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

  // ---- gouache shading ----
  const ramp = (() => {
    const n = 64, d = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1), s = (a, b, t) => { const k = clamp((t - a) / (b - a), 0, 1); return k * k * (3 - 2 * k); };
      const v = 0.3 + 0.3 * s(0.43, 0.53, x) + 0.4 * s(0.6, 0.8, x);
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.round(v * 255); d[i * 4 + 3] = 255;
    }
    const t = new THREE.DataTexture(d, n, 1, THREE.RGBAFormat);
    t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
  })();
  const KIND = {
    ceramic: { spec: 0.75, shin: 70, thr: 0.5, edge: 0.7, col: [1, 0.97, 0.9] },
    brass: { spec: 1.1, shin: 26, thr: 0.35, edge: 0.9, col: [1, 0.9, 0.62] },
    metal: { spec: 0.6, shin: 40, thr: 0.45, edge: 0.6, col: [1, 1, 1] },
    wood: { spec: 0.14, shin: 14, thr: 0.5, edge: 0.6, col: [1, 0.95, 0.85] },
    paper: { spec: 0.0, shin: 8, thr: 0.5, edge: 0.45, col: [1, 1, 1] },
    wax: { spec: 0.22, shin: 10, thr: 0.4, edge: 0.3, col: [1, 1, 0.95] },
    glass: { spec: 1.2, shin: 90, thr: 0.4, edge: 0.4, col: [1, 1, 1] },
    felt: { spec: 0, shin: 4, thr: 0.5, edge: 0.2, col: [1, 1, 1] },
  };
  const shared = { uGround: { value: 0 }, uGrain: { value: 1 }, uPx: { value: 0.0006 }, uOrtho: { value: 0 } };
  function painterly(params) {
    const k = KIND[params.kind] || KIND.wood;
    const mat = new THREE.MeshToonMaterial({ color: params.color || 0xffffff, map: params.map || null, gradientMap: ramp, transparent: !!params.transparent, opacity: params.opacity == null ? 1 : params.opacity, side: params.side || THREE.FrontSide });
    const u = {
      uSpec: { value: k.spec }, uShin: { value: k.shin }, uThr: { value: k.thr }, uEdge: { value: k.edge },
      uSpecCol: { value: new THREE.Color().setRGB(k.col[0], k.col[1], k.col[2]) },
      uTint: { value: new THREE.Color(1, 1, 1) }, uTintAmt: { value: 0 }, uAOH: { value: params.aoH == null ? 2.2 : params.aoH }, uAOMin: { value: params.aoMin == null ? 0.66 : params.aoMin },
      uGround: shared.uGround, uGrain: shared.uGrain,
    };
    mat.userData.u = u;
    mat.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'varying vec3 vWPos;\n' + sh.vertexShader.replace('#include <fog_vertex>', '#include <fog_vertex>\n vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = `varying vec3 vWPos; uniform float uSpec, uShin, uThr, uEdge, uTintAmt, uAOH, uAOMin, uGround, uGrain; uniform vec3 uSpecCol, uTint;
float olt_h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
` + sh.fragmentShader
        .replace('#include <opaque_fragment>', `
  {
    vec3 Vd = normalize(vViewPosition);
    #if NUM_DIR_LIGHTS > 0
      vec3 Hh = normalize(directionalLights[0].direction + Vd);
      float sp = pow(max(dot(normal, Hh), 0.0), uShin);
      sp = smoothstep(uThr, uThr + 0.14, sp) * uSpec;
      outgoingLight += uSpecCol * sp * 0.42;
    #endif
    float fres = 1.0 - max(dot(normal, Vd), 0.0);
    outgoingLight *= 1.0 - uEdge * 0.32 * pow(fres, 2.2);
    outgoingLight *= mix(uAOMin, 1.0, smoothstep(0.0, uAOH, vWPos.y - uGround));
    outgoingLight = mix(outgoingLight, uTint, uTintAmt);
  }
  #include <opaque_fragment>`)
        .replace('#include <dithering_fragment>', `#include <dithering_fragment>
  gl_FragColor.rgb *= 1.0 + (olt_h(floor(gl_FragCoord.xy / 1.5)) - 0.5) * 0.08 * uGrain;`);
    };
    mat.customProgramCacheKey = () => 'olt-painterly';
    return mat;
  }

  // inked outline: inverted hull, constant screen width, wobbling thickness
  function outlineMat(color, width, seed) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uW: { value: width }, uSeed: { value: seed || 0 }, uOpacity: { value: 1 }, uPx: shared.uPx, uOrtho: shared.uOrtho },
      vertexShader: `attribute vec3 sNormal; uniform float uW, uSeed, uPx, uOrtho;
        void main(){
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vec3 n = normalize(normalMatrix * sNormal);
          float j = 0.62 + 0.75 * (0.5 + 0.5 * sin(position.x * 2.1 + position.y * 3.3 + uSeed) * sin(position.z * 2.7 - position.y * 1.7 + uSeed * 1.3));
          mv.xyz += n * uW * uPx * mix(-mv.z, 1.0, uOrtho) * j;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `uniform vec3 uColor; uniform float uOpacity; void main(){ gl_FragColor = vec4(uColor, uOpacity); }`,
      side: THREE.BackSide, transparent: true,
    });
  }
  // smooth normals for outline hulls (merge coincident positions)
  function smoothNormals(geo) {
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
    const map = new Map(), acc = new Float32Array(n * 3);
    const key = i => `${Math.round(pos.getX(i) * 400)},${Math.round(pos.getY(i) * 400)},${Math.round(pos.getZ(i) * 400)}`;
    const sums = new Map();
    for (let i = 0; i < n; i++) { const k = key(i); let s = sums.get(k); if (!s) { s = [0, 0, 0]; sums.set(k, s); } s[0] += nor.getX(i); s[1] += nor.getY(i); s[2] += nor.getZ(i); map.set(i, s); }
    for (let i = 0; i < n; i++) { const s = map.get(i), l = Math.hypot(s[0], s[1], s[2]) || 1; acc[i * 3] = s[0] / l; acc[i * 3 + 1] = s[1] / l; acc[i * 3 + 2] = s[2] / l; }
    geo.setAttribute('sNormal', new THREE.BufferAttribute(acc, 3));
  }

  // ---- geometry builders (mirror Catalog.featParts) ----
  function buildGeo(positions, uvs, indices) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    if (indices) g.setIndex(indices);
    g.computeVertexNormals();
    return g;
  }
  function resample(prof, maxSeg) {
    const out = [prof[0]];
    for (let i = 1; i < prof.length; i++) {
      const a = prof[i - 1], b = prof[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), k = Math.max(1, Math.min(6, Math.ceil(L / maxSeg)));
      for (let j = 1; j <= k; j++) out.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]);
    }
    return out;
  }
  // Lathe along a 2D path; returns geometry with u around (0.25 = +z) and v along the path.
  function lathePath(path, segs, sx, sz, wob, seed, vRange = [0, 1], reverse = false) {
    const pos = [], uv = [], idx = [];
    let total = 0; const acc = [0];
    for (let i = 1; i < path.length; i++) { total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); acc.push(total); }
    for (let i = 0; i < path.length; i++) {
      const [r, y] = path[i];
      for (let j = 0; j <= segs; j++) {
        const a = j / segs * Math.PI * 2;
        const w = wob ? 1 + wob * (2 * noise3(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4, y * 0.35) - 1) : 1;
        pos.push(r * w * Math.cos(a) * sx, y, r * w * Math.sin(a) * sz);
        uv.push(j / segs, lerp(vRange[0], vRange[1], total ? acc[i] / total : 0));
      }
    }
    const row = segs + 1;
    for (let i = 0; i < path.length - 1; i++) for (let j = 0; j < segs; j++) {
      const a = i * row + j, b = (i + 1) * row + j, c = i * row + j + 1, d = (i + 1) * row + j + 1;
      if (!reverse) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
    const g = buildGeo(pos, uv, idx);
    fixSeam(g, path.length, row);
    return g;
  }
  function fixSeam(g, rows, row) {
    const n = g.attributes.normal;
    for (let i = 0; i < rows; i++) {
      const a = i * row, b = i * row + row - 1;
      const x = n.getX(a) + n.getX(b), y = n.getY(a) + n.getY(b), z = n.getZ(a) + n.getZ(b), l = Math.hypot(x, y, z) || 1;
      n.setXYZ(a, x / l, y / l, z / l); n.setXYZ(b, x / l, y / l, z / l);
    }
  }
  function disc(r, y, segs, sx, sz, up, wob, seed) {
    const pos = [0, y, 0], uv = [0.5, up ? 1 : 0], idx = [];
    for (let j = 0; j <= segs; j++) {
      const a = j / segs * Math.PI * 2;
      const w = wob ? 1 + wob * (2 * noise3(Math.cos(a) * 1.4 + seed, Math.sin(a) * 1.4, y * 0.35) - 1) : 1;
      pos.push(r * w * Math.cos(a) * sx, y, r * w * Math.sin(a) * sz); uv.push(j / segs, up ? 0.98 : 0.02);
    }
    for (let j = 1; j <= segs; j++) up ? idx.push(0, j + 1, j) : idx.push(0, j, j + 1);
    return buildGeo(pos, uv, idx);
  }
  function boxGeo(corners) {
    const C = (x, y, z) => corners[(y > 0 ? 4 : 0) + (x > 0 ? 2 : 0) + (z > 0 ? 1 : 0)];
    const faces = [
      ['front', [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]], ['back', [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
      ['right', [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]], ['left', [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
      ['top', [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]], ['bottom', [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
    ];
    const cell = { front: [0, 0], back: [1, 0], top: [2, 0], right: [0, 1], left: [1, 1], bottom: [2, 1] };
    const pos = [], uv = [], idx = [];
    for (const [name, q] of faces) {
      const [c, r] = cell[name], base = pos.length / 3, u0 = c / 3, v1 = 1 - r * 0.5, v0 = v1 - 0.5;
      const uvq = [[0, 0], [1, 0], [1, 1], [0, 1]];
      q.forEach((s, k) => { const p = C(s[0], s[1], s[2]); pos.push(p[0], p[1], p[2]); uv.push(u0 + uvq[k][0] / 3 * 0.98 + 0.003, v0 + uvq[k][1] * 0.49 + 0.005); });
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    return buildGeo(pos, uv, idx);
  }
  function prismGeo(poly, depth) {
    let area = 0; for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; }
    const P = area < 0 ? poly.slice().reverse() : poly;
    let mnx = Infinity, mxx = -Infinity, mny = Infinity, mxy = -Infinity;
    for (const [x, y] of P) { mnx = Math.min(mnx, x); mxx = Math.max(mxx, x); mny = Math.min(mny, y); mxy = Math.max(mxy, y); }
    const pos = [], uv = [], idx = [], hz = depth / 2;
    const s = x => (x - mnx) / (mxx - mnx || 1), t = y => (y - mny) / (mxy - mny || 1);
    let b = 0;
    for (const [x, y] of P) { pos.push(x, y, hz); uv.push(s(x) * 0.5, 0.3 + t(y) * 0.7); }
    for (let i = 1; i < P.length - 1; i++) idx.push(b, b + i, b + i + 1);
    b = pos.length / 3;
    for (const [x, y] of P) { pos.push(x, y, -hz); uv.push(0.5 + (1 - s(x)) * 0.5, 0.3 + t(y) * 0.7); }
    for (let i = 1; i < P.length - 1; i++) idx.push(b, b + i + 1, b + i);
    let per = 0; const L = [0];
    for (let i = 0; i < P.length; i++) { const a = P[i], c = P[(i + 1) % P.length]; per += Math.hypot(c[0] - a[0], c[1] - a[1]); L.push(per); }
    for (let i = 0; i < P.length; i++) {
      const a = P[i], c = P[(i + 1) % P.length]; b = pos.length / 3;
      pos.push(a[0], a[1], -hz, c[0], c[1], -hz, c[0], c[1], hz, a[0], a[1], hz);
      const u0 = L[i] / per, u1 = L[i + 1] / per;
      uv.push(u0, 0, u1, 0, u1, 0.29, u0, 0.29);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
    return buildGeo(pos, uv, idx);
  }
  function tubeGeo(path, r0, r1, closed) {
    const n = path.length, segs = 12, pos = [], uv = [], idx = [];
    const P = path.map(p => new THREE.Vector3(p[0], p[1], p[2]));
    const T = P.map((p, i) => { const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]; return b.clone().sub(a).normalize(); });
    let N = new THREE.Vector3(0, 0, 1); if (Math.abs(T[0].z) > 0.9) N.set(1, 0, 0);
    N = N.sub(T[0].clone().multiplyScalar(N.dot(T[0]))).normalize();
    const frames = [];
    for (let i = 0; i < n; i++) {
      if (i > 0) { N = N.sub(T[i].clone().multiplyScalar(N.dot(T[i]))).normalize(); }
      frames.push([N.clone(), T[i].clone().cross(N).normalize()]);
    }
    for (let i = 0; i < n; i++) {
      const r = lerp(r0, r1, i / (n - 1)), [Nn, B] = frames[i];
      for (let j = 0; j <= segs; j++) {
        const a = j / segs * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
        pos.push(P[i].x + (Nn.x * c + B.x * s) * r, P[i].y + (Nn.y * c + B.y * s) * r, P[i].z + (Nn.z * c + B.z * s) * r);
        uv.push(j / segs, i / (n - 1));
      }
    }
    const row = segs + 1;
    for (let i = 0; i < n - 1; i++) for (let j = 0; j < segs; j++) { const a = i * row + j, b = (i + 1) * row + j; idx.push(a, a + 1, b, b, a + 1, b + 1); }
    if (!closed) for (const [i, flip] of [[0, true], [n - 1, false]]) {
      const ci = pos.length / 3; pos.push(P[i].x, P[i].y, P[i].z); uv.push(0.5, 0.5);
      for (let j = 0; j < segs; j++) { const a = i * row + j; flip ? idx.push(ci, a + 1, a) : idx.push(ci, a, a + 1); }
    }
    const g = buildGeo(pos, uv, idx);
    // tube winding may face inward depending on the frame handedness; check and flip
    g.computeBoundingSphere();
    return g;
  }

  // ---- materials & textures for an object definition ----
  const texCache = new Map();
  function texFor(def, key, layout, seedBase) {
    const id = def.id + ':' + key + ':' + layout;
    if (texCache.has(id)) return texCache.get(id);
    const spec = def.mats[key].paint;
    const cv = Paint.texture(spec, layout, seedBase + U.hashStr(key));
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    t.wrapS = THREE.RepeatWrapping;
    texCache.set(id, t);
    return t;
  }
  const matCache = new Map();
  function matFor(def, key, layout) {
    const id = def.id + ':' + key + ':' + layout;
    if (matCache.has(id)) return matCache.get(id);
    const m = painterly({ kind: def.mats[key].kind, map: texFor(def, key, layout, U.hashStr(def.id)) });
    matCache.set(id, m); return m;
  }
  function innerMat(def, key) {
    const id = def.id + ':' + key + ':inner';
    if (matCache.has(id)) return matCache.get(id);
    const p = def.mats[key].paint, c = p.inner || Paint.shade(p.glaze || p.base, -0.22);
    const m = painterly({ kind: 'ceramic', color: new THREE.Color(c), side: THREE.DoubleSide, aoMin: 0.45 });
    m.userData.u.uSpec.value = 0.2;
    matCache.set(id, m); return m;
  }
  const glassMat = painterly({ kind: 'glass', color: new THREE.Color('#9fb7c4') });

  // ---- object meshes ----
  function buildObject(def, scale, seed) {
    const group = new THREE.Group();
    const meshes = [];
    const add = (geo, mat, fp, fq, extra) => {
      const m = new THREE.Mesh(geo, mat);
      if (fp) m.position.set(fp[0], fp[1], fp[2]);
      if (fq) m.quaternion.set(fq[0], fq[1], fq[2], fq[3]);
      if (extra) extra(m);
      m.castShadow = true; m.receiveShadow = true;
      group.add(m); meshes.push(m); return m;
    };
    for (const f of def.feats) {
      const mat = def.mats[f.mat];
      switch (f.k) {
        case 'lathe': {
          const prof = resample(f.prof, 0.5), sx = f.sx || 1, sz = f.sz || 1, wob = f.wob || 0, sd = (seed % 97) * 0.37;
          add(lathePath(prof, 40, sx, sz, wob, sd), matFor(def, f.mat, 'lathe'), f.p, f.q);
          if (prof[0][0] > 0.01) add(disc(prof[0][0], prof[0][1], 40, sx, sz, false, wob, sd), matFor(def, f.mat, 'lathe'), f.p, f.q);
          const top = prof[prof.length - 1];
          if (f.open) {
            const th = Math.min(0.16, top[0] * 0.25), inner = [];
            if (f.open && top[0] > 1.6 && prof.length > 3 && def.id !== 'vase') {
              // wide open bell: inner surface follows the profile all the way down
              for (let i = prof.length - 1; i >= 0; i--) inner.push([Math.max(0.02, prof[i][0] - th), prof[i][1] + (i === 0 ? th : 0)]);
            } else {
              const depth = Math.min(1.6, (top[1] - prof[0][1]) * 0.3);
              inner.push([top[0] - th, top[1]], [top[0] - th, top[1] - depth * 0.5], [Math.max(0.05, top[0] - th * 1.6), top[1] - depth], [0.0, top[1] - depth]);
            }
            const lip = [[top[0], top[1]]].concat(inner);
            add(lathePath(lip, 40, sx, sz, wob, sd, [1, 1], true), innerMat(def, f.mat), f.p, f.q);
          } else if (top[0] > 0.01) add(disc(top[0], top[1], 40, sx, sz, true, wob, sd), matFor(def, f.mat, 'lathe'), f.p, f.q);
          break;
        }
        case 'bowl': {
          const rows = Catalog.bowlRows(f), path = [[f.rb, 0]];
          for (const r of rows) path.push([r.ro, r.y]);
          path.push([rows[rows.length - 1].ri, f.h]);
          for (let i = rows.length - 1; i >= 0; i--) path.push([rows[i].ri, rows[i].y]);
          path.push([0, f.floor * 0.6]);
          const pr = resample(path, 0.6);
          add(lathePath(pr, 48, 1, 1, 0, 0), matFor(def, f.mat, 'lathe'), f.p, f.q, m => { m.material = m.material; });
          add(disc(f.rb, 0, 48, 1, 1, false), matFor(def, f.mat, 'lathe'), f.p, f.q);
          break;
        }
        case 'cyl': {
          const g = new THREE.CylinderGeometry(f.r1 == null ? f.r0 : f.r1, f.r0, f.h, 32, 1);
          if (f.sx || f.sz) g.scale(f.sx || 1, 1, f.sz || 1);
          add(g, matFor(def, f.mat, 'lathe'), f.p, f.q);
          if (def.id === 'mirror' && f.mat === 'body') {
            const glass = new THREE.CylinderGeometry(f.r1 * 0.82, f.r1 * 0.82, 0.04, 40);
            add(glass, glassMat, [f.p[0], f.p[1] + f.h / 2 - 0.01, f.p[2]], f.q);
          }
          if (def.id === 'candle' && f.mat === 'wax') {
            add(new THREE.CylinderGeometry(0.05, 0.06, 0.5, 6), painterly({ kind: 'wood', color: new THREE.Color('#2c1d16') }), [f.p[0], f.p[1] + f.h / 2 - 0.3, f.p[2]], f.q);
          }
          break;
        }
        case 'box': {
          const corners = Catalog.boxCorners(f);
          add(boxGeo(corners), matFor(def, f.mat, 'box'), f.p, f.q);
          break;
        }
        case 'prism': add(prismGeo(f.poly, f.depth), matFor(def, f.mat, 'prism'), f.p, f.q); break;
        case 'sph': { const g = new THREE.SphereGeometry(1, 32, 20); g.scale(f.r[0], f.r[1], f.r[2]); add(g, matFor(def, f.mat, 'lathe'), f.p, f.q); break; }
        case 'cap': {
          const a = new THREE.Vector3(...f.a), b = new THREE.Vector3(...f.b), L = a.distanceTo(b);
          const g = new THREE.CapsuleGeometry(f.r, L, 5, 14);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          const mid = a.clone().add(b).multiplyScalar(0.5);
          add(g, matFor(def, f.mat, 'lathe'), null, null, m => { m.position.copy(mid); m.quaternion.copy(q); });
          break;
        }
        case 'tube': { const path = Catalog.catmull(f.pts, 40); add(tubeGeo(path, f.r, f.r * (f.taper || 1), false), matFor(def, f.mat, 'lathe'), f.p, f.q, m => { m.material = m.material.clone ? m.material : m.material; m.material.side = THREE.DoubleSide; }); break; }
        case 'ring': { const path = Catalog.ringPath(f.R, 48); add(tubeGeo(path, f.r, f.r, true), matFor(def, f.mat, 'lathe'), f.p, f.q, m => { m.material.side = THREE.DoubleSide; }); break; }
        case 'dome': {
          const g = new THREE.SphereGeometry(1, 36, 14, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(f.r[0], f.r[1], f.r[2]);
          const p = g.attributes.position, uvA = g.attributes.uv;
          for (let i = 0; i < p.count; i++) uvA.setXY(i, p.getX(i) / (2 * f.r[0]) + 0.5, 0.5 - p.getZ(i) / (2 * f.r[2]));
          add(g, matFor(def, f.mat, 'dome'), f.p, f.q);
          const d = new THREE.CircleGeometry(1, 36); d.rotateX(Math.PI / 2); d.scale(f.r[0], 1, f.r[2]);
          add(d, matFor(def, f.mat, 'dome'), f.p, f.q);
          break;
        }
      }
    }
    // outlines: one hull per mesh, sharing a per-object material so colour can signal state
    const oMat = outlineMat(0x2a1a12, 1.5, seed % 13);
    const outlines = [];
    for (const m of meshes) {
      const g = m.geometry;
      if (!g.attributes.sNormal) smoothNormals(g);
      const o = new THREE.Mesh(g, oMat);
      o.position.copy(m.position); o.quaternion.copy(m.quaternion); o.scale.copy(m.scale);
      o.renderOrder = -1; group.add(o); outlines.push(o);
    }
    if (scale !== 1) group.scale.setScalar(scale);
    // geometric extents in object space (for the tray)
    const box = new THREE.Box3().setFromObject(group);
    return { group, meshes, outlines, oMat, box };
  }
  function ghostOf(obj, color) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.2, depthWrite: false });
    const om = outlineMat(color, 1.2, 3); om.uniforms.uOpacity.value = 0.75;
    for (const m of obj.meshes) {
      const a = new THREE.Mesh(m.geometry, mat); a.position.copy(m.position); a.quaternion.copy(m.quaternion); g.add(a);
      const o = new THREE.Mesh(m.geometry, om); o.position.copy(m.position); o.quaternion.copy(m.quaternion); g.add(o);
    }
    g.scale.copy(obj.group.scale);
    g.userData = { mat, om };
    return g;
  }

  // ---- the drawer ----
  let drawer = null;
  const woodTex = (() => { const c = Paint.canvas(512, 256), g = c.getContext('2d'); Paint.FNS.drawerWood(g, 512, 256, { base: '#8a5230' }, rng(4)); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
  const innerTex = (() => { const c = Paint.canvas(512, 256), g = c.getContext('2d'); Paint.FNS.drawerWood(g, 512, 256, { base: '#b98a5c' }, rng(5)); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
  function feltTex(color) { const c = Paint.canvas(512, 384), g = c.getContext('2d'); Paint.FNS.felt(g, 512, 384, { base: color }, rng(6)); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
  const woodMat = painterly({ kind: 'wood', map: woodTex, aoMin: 0.8 });
  const innerWoodMat = painterly({ kind: 'wood', map: innerTex, aoMin: 0.62, aoH: 3 });
  const brassMat = painterly({ kind: 'brass', map: (() => { const c = Paint.texture({ fn: 'brass', base: '#c4993f' }, 'lathe', 9); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })() });
  function labelTex(lines) {
    const c = Paint.canvas(256, 128), g = c.getContext('2d');
    g.fillStyle = '#efe4cc'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#3a2418'; g.textAlign = 'center';
    g.font = '400 50px "DM Serif Display", Georgia, serif'; g.fillText(lines[0], 128, 62);
    g.font = 'italic 300 28px "Cormorant Garamond", Georgia, serif'; g.fillText(lines[1], 128, 104);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  const LININGS = ['#2f6b66', '#7c2f35', '#56562a', '#3d5a78', '#6e3a52'];
  function buildDrawer(W, D, H, info) {
    if (drawer) { scene.remove(drawer.group); drawer.group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }
    const group = new THREE.Group(), t = 1.05, fb = 0.8;
    const outl = outlineMat(0x2a1a12, 1.7, 5);
    const piece = (w, h, d, x, y, z, mats) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const m = new THREE.Mesh(g, mats); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; group.add(m);
      smoothNormals(g); const o = new THREE.Mesh(g, outl); o.position.copy(m.position); o.renderOrder = -1; group.add(o);
      return m;
    };
    const M6 = (inner) => [inner === 'px' ? innerWoodMat : woodMat, inner === 'nx' ? innerWoodMat : woodMat, woodMat, woodMat, inner === 'pz' ? innerWoodMat : woodMat, inner === 'nz' ? innerWoodMat : woodMat];
    piece(W + 2 * t, fb, D + 2 * t, 0, -fb / 2, 0, woodMat);
    piece(t, H, D, -W / 2 - t / 2, H / 2, 0, M6('px'));
    piece(t, H, D, W / 2 + t / 2, H / 2, 0, M6('nx'));
    piece(W + 2 * t, H, t, 0, H / 2, -D / 2 - t / 2, M6('pz'));
    const fh = H + fb + 0.5, fw = W + 2 * t + 0.7;
    const front = piece(fw, fh, 1.25, 0, -fb - 0.25 + fh / 2, D / 2 + 0.625, M6('nz'));
    // felt lining
    const felt = new THREE.Mesh(new THREE.PlaneGeometry(W, D), painterly({ kind: 'felt', map: feltTex(LININGS[info.index % LININGS.length]), aoMin: 0.72, aoH: 1.5 }));
    felt.rotation.x = -Math.PI / 2; felt.position.y = 0.004; felt.receiveShadow = true; group.add(felt);
    // brass bail pull, keyhole and label holder on the front
    const fz = D / 2 + 1.25, cy = -fb - 0.25 + fh * 0.48;
    const pullW = Math.min(7, W * 0.3);
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.18, 20), brassMat); plate.rotation.x = Math.PI / 2; plate.position.set(s * pullW / 2, cy, fz + 0.09); plate.castShadow = true; group.add(plate);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.7, 10), brassMat); post.rotation.x = Math.PI / 2; post.position.set(s * pullW / 2, cy, fz + 0.4); group.add(post);
    }
    const bailPath = []; for (let i = 0; i <= 24; i++) { const a = i / 24; bailPath.push([lerp(-pullW / 2, pullW / 2, a), cy - Math.sin(a * Math.PI) * 1.1, fz + 0.75]); }
    const bail = new THREE.Mesh(tubeGeo(bailPath, 0.17, 0.17, false), brassMat); bail.castShadow = true; group.add(bail);
    const holder = new THREE.Mesh(new THREE.BoxGeometry(4.2, 2.3, 0.12), brassMat); holder.position.set(0, cy + Math.min(2.6, fh * 0.28), fz + 0.06); group.add(holder);
    const card = new THREE.Mesh(new THREE.PlaneGeometry(3.7, 1.85), new THREE.MeshBasicMaterial({ map: labelTex(['No. ' + (info.index + 1), `${fmt(W)} × ${fmt(D)} × ${fmt(H)}`]) }));
    card.position.set(0, holder.position.y, fz + 0.13); group.add(card);
    const esc = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.1, 16), brassMat); esc.rotation.x = Math.PI / 2; esc.position.set(0, cy - 1.0, fz + 0.05); group.add(esc);
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.45), new THREE.MeshBasicMaterial({ color: 0x1d120c })); hole.position.set(0, cy - 1.05, fz + 0.11); group.add(hole);
    scene.add(group);
    for (const k in glowPieces) delete glowPieces[k];
    ground.position.y = -fb - 0.25;
    // shadow camera hugs the drawer
    const R = Math.max(W, D) / 2 + 14;
    Object.assign(key.shadow.camera, { left: -R, right: R, top: R, bottom: -R, near: 1, far: 120 });
    key.shadow.camera.updateProjectionMatrix();
    drawer = { group, W, D, H, t, fb, fh, front, outer: { x: W / 2 + t + 0.35, z0: -D / 2 - t, z1: D / 2 + 1.25, y0: -fb - 0.25, y1: H + 0.5 } };
    return drawer;
  }
  const fmt = v => (Math.round(v * 10) / 10).toString();

  // ---- held-object helpers: drop line ----
  const dropLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineDashedMaterial({ color: 0x3a2418, dashSize: 0.35, gapSize: 0.3, transparent: true, opacity: 0.55 }));
  dropLine.visible = false; scene.add(dropLine);
  function setDropLine(a, b) {
    if (!a) { dropLine.visible = false; return; }
    dropLine.geometry.setFromPoints([new THREE.Vector3(a[0], a[1], a[2]), new THREE.Vector3(b[0], b[1], b[2])]);
    dropLine.computeLineDistances(); dropLine.visible = true;
  }
  // vermilion glow on the wall (inner face + its top edge) that an object would cross
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xd4462a, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const glowGroup = new THREE.Group(); scene.add(glowGroup);
  const glowPieces = {};
  function glowFor(side) {
    if (glowPieces[side]) return glowPieces[side];
    const g = new THREE.Group(), { W, D, H, t } = drawer;
    const strip = (w, d, x, z) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), glowMat); m.rotation.x = -Math.PI / 2; m.position.set(x, H + 0.03, z); g.add(m); };
    const wall = (w, h, x, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glowMat); m.rotation.y = ry; m.position.set(x, h / 2, z); g.add(m); };
    if (side === 'left' || side === 'right') { const sx = side === 'left' ? -1 : 1; strip(t + 0.2, D + 2 * t, sx * (W / 2 + t / 2), 0); wall(D, H, sx * (W / 2 - 0.03), 0, Math.PI / 2); }
    if (side === 'back') { strip(W + 2 * t, t + 0.2, 0, -D / 2 - t / 2); wall(W, H, 0, -D / 2 + 0.03, 0); }
    if (side === 'front') { const m = new THREE.Mesh(new THREE.PlaneGeometry(W + 2 * t + 0.7, 1.3), glowMat); m.rotation.x = -Math.PI / 2; m.position.set(0, drawer.H + 0.53, D / 2 + 0.625); g.add(m); }
    if (side === 'top') for (const s2 of ['left', 'right', 'back', 'front']) { const c = glowFor(s2); g.add(c.clone()); }
    glowPieces[side] = g; return g;
  }
  function glowWall(side, amt) {
    glowMat.opacity = amt * 0.45;
    for (const c of [...glowGroup.children]) glowGroup.remove(c);
    if (!drawer || !side || side === 'floor' || amt <= 0.001) return;
    glowGroup.add(glowFor(side));
  }

  // ---- layout and cameras ----
  const view = { w: 1, h: 1, drawerRect: { x: 0, y: 0, w: 1, h: 1 }, trayRect: { x: 0, y: 0, w: 1, h: 0 } };
  const orbit = { az: 0.34, pol: 0.66, dist: 60, fit: 60, target: new THREE.Vector3(), azT: 0.34, polT: 0.66, distT: 60, zoom: 1, zoomT: 1 };
  function layout(w, h, drawerRect, trayRect) {
    view.w = w; view.h = h; view.drawerRect = drawerRect; view.trayRect = trayRect;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    fitCamera();
  }
  function placeCamera(az, pol, dist) {
    const t = orbit.target;
    camera.position.set(t.x + Math.sin(az) * Math.sin(pol) * dist, t.y + Math.cos(pol) * dist, t.z + Math.cos(az) * Math.sin(pol) * dist);
    camera.lookAt(t);
    camera.updateMatrixWorld();
  }
  // Fit the drawer into the drawer rect: view offset centres it, distance makes it fill.
  function fitCamera() {
    if (!drawer) return;
    const r = view.drawerRect, o = drawer.outer;
    camera.aspect = view.w / view.h;
    // shift the projection centre to the middle of the drawer rect
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    camera.setViewOffset(view.w, view.h, view.w / 2 - cx, view.h / 2 - cy, view.w, view.h);
    orbit.target.set(0, drawer.H * 0.3, (o.z0 + o.z1) / 2 * 0.5);
    const pts = [];
    for (const x of [-o.x, o.x]) for (const y of [o.y0, o.y1]) for (const z of [o.z0, o.z1]) pts.push(new THREE.Vector3(x, y, z));
    let lo = 10, hi = 400;
    for (let i = 0; i < 26; i++) {
      const d = (lo + hi) / 2;
      placeCamera(orbit.azT, orbit.polT, d); camera.updateProjectionMatrix();
      let mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9;
      for (const p of pts) { const q = p.clone().project(camera); const sx = (q.x * 0.5 + 0.5) * view.w, sy = (0.5 - q.y * 0.5) * view.h; mnx = Math.min(mnx, sx); mxx = Math.max(mxx, sx); mny = Math.min(mny, sy); mxy = Math.max(mxy, sy); }
      const fits = (mxx - mnx) < r.w * 0.94 && (mxy - mny) < r.h * 0.94;
      if (fits) hi = d; else lo = d;
    }
    orbit.fit = hi; orbit.distT = hi * orbit.zoomT;
    if (!orbit.init) { orbit.dist = orbit.distT; orbit.az = orbit.azT; orbit.pol = orbit.polT; orbit.init = true; }
    placeCamera(orbit.az, orbit.pol, orbit.dist);
  }
  function resetOrbit() { orbit.azT = 0.34; orbit.polT = 0.66; orbit.zoomT = 1; orbit.distT = orbit.fit; }
  function nudgeOrbit(daz, dpol, zoomMul) {
    orbit.azT = clamp(orbit.azT + daz, -0.95, 1.35);
    orbit.polT = clamp(orbit.polT + dpol, 0.45, 1.22);
    if (zoomMul) orbit.zoomT = clamp(orbit.zoomT * zoomMul, 0.62, 1.3);
    orbit.distT = orbit.fit * orbit.zoomT;
  }
  function updateCamera(dt) {
    const k = 1 - Math.exp(-dt * 10);
    orbit.az += (orbit.azT - orbit.az) * k; orbit.pol += (orbit.polT - orbit.pol) * k; orbit.dist += (orbit.distT - orbit.dist) * k;
    placeCamera(orbit.az, orbit.pol, orbit.dist);
  }

  // tray camera: an orthographic catalogue shelf. slotW in px, x in slot units of 10 cm.
  const tray = { slotPx: 92, scroll: 0, unit: 10 };
  function trayLayout() {
    const r = view.trayRect; if (r.h <= 0) return;
    const wU = r.w / tray.slotPx * tray.unit, hU = r.h / tray.slotPx * tray.unit;
    trayCam.left = -wU / 2; trayCam.right = wU / 2; trayCam.top = hU / 2; trayCam.bottom = -hU / 2;
    trayCam.position.set(wU / 2 - tray.unit / 2 + tray.scroll, 9, 30); trayCam.lookAt(wU / 2 - tray.unit / 2 + tray.scroll, 2.6, 0);
    trayCam.updateProjectionMatrix();
  }

  const ray = new THREE.Raycaster();
  function ndc(x, y) { return new THREE.Vector2(x / view.w * 2 - 1, -(y / view.h) * 2 + 1); }
  function pick(x, y, groups) {
    ray.setFromCamera(ndc(x, y), camera);
    const hits = ray.intersectObjects(groups, true);
    for (const h of hits) { let o = h.object; while (o && !o.userData.objRef) o = o.parent; if (o && h.object.material && !h.object.material.isShaderMaterial) return { obj: o.userData.objRef, point: h.point }; }
    return null;
  }
  function planeHit(x, y, py) {
    ray.setFromCamera(ndc(x, y), camera);
    const p = new THREE.Plane(new THREE.Vector3(0, 1, 0), -py), out = new THREE.Vector3();
    return ray.ray.intersectPlane(p, out) ? out : null;
  }
  function project(p) { const v = new THREE.Vector3(p[0], p[1], p[2]).project(camera); return [(v.x * 0.5 + 0.5) * view.w, (0.5 - v.y * 0.5) * view.h]; }

  function render() {
    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, view.w, view.h);
    renderer.clear();
    shared.uGround.value = 0;
    shared.uOrtho.value = 0; shared.uPx.value = 2 * Math.tan(camera.fov * Math.PI / 360) / view.h; // world units per CSS px at depth 1
    renderer.render(scene, camera);
    const r = view.trayRect;
    if (r.h > 4) {
      trayLayout();
      renderer.setScissorTest(true);
      renderer.setScissor(r.x, view.h - r.y - r.h, r.w, r.h);
      renderer.setViewport(r.x, view.h - r.y - r.h, r.w, r.h);
      renderer.clearDepth();
      shared.uGround.value = -50; // no floor AO on the shelf
      shared.uOrtho.value = 1; shared.uPx.value = (trayCam.top - trayCam.bottom) / r.h;
      renderer.render(trayScene, trayCam);
      renderer.setScissorTest(false);
    }
  }
  function dispose() {
    renderer.dispose();
    for (const t of texCache.values()) t.dispose();
    for (const m of matCache.values()) m.dispose();
  }

  return { THREE, renderer, scene, trayScene, camera, trayCam, key, buildObject, ghostOf, buildDrawer, painterly, layout, fitCamera, resetOrbit, nudgeOrbit, updateCamera, orbit, tray, trayLayout, pick, planeHit, project, render, setDropLine, glowWall, dispose, get drawer() { return drawer; }, view, shared };
}
