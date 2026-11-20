// Painterly materials, procedural textures and a geometry builder that bakes
// colour into vertices so a whole building can be drawn in one call.
function createPaint(THREE, scratch) {
  const P = {};
  // A soft three-band light ramp: shadow, mid, lit. Linear filtering keeps
  // the band edges soft, like a gouache wash rather than cel shading.
  {
    const n = 64, data = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      const v = 0.58 + 0.17 * smooth((x - 0.18) / 0.16) + 0.25 * smooth((x - 0.55) / 0.18);
      const c = Math.round(v * 255); data.set([c, c, c, 255], i * 4);
    }
    P.ramp = new THREE.DataTexture(data, n, 1, THREE.RGBAFormat);
    P.ramp.minFilter = P.ramp.magFilter = THREE.LinearFilter; P.ramp.needsUpdate = true;
  }
  const NOISE_GLSL = `
    float twkH(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float twkN(vec3 x){ vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
      return mix(mix(mix(twkH(i+vec3(0,0,0)),twkH(i+vec3(1,0,0)),f.x), mix(twkH(i+vec3(0,1,0)),twkH(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(twkH(i+vec3(0,0,1)),twkH(i+vec3(1,0,1)),f.x), mix(twkH(i+vec3(0,1,1)),twkH(i+vec3(1,1,1)),f.x),f.y), f.z); }`;
  // Toon material with world-space brush variation baked in.
  P.mat = (opts = {}) => {
    const m = new THREE.MeshToonMaterial(Object.assign({ color: 0xffffff, gradientMap: P.ramp, vertexColors: true }, opts.params || {}));
    const brush = opts.brush ?? 0.13, scale = opts.scale ?? 1.4;
    m.onBeforeCompile = sh => {
      sh.uniforms.uBrush = { value: brush };
      sh.uniforms.uEmissive = opts.emissiveU || { value: 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vTwkW;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 twkWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            twkWp = instanceMatrix * twkWp;
          #endif
          vTwkW = (modelMatrix * twkWp).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTwkW;\nuniform float uBrush;\nuniform float uEmissive;\n' + NOISE_GLSL)
        .replace('#include <color_fragment>', `#include <color_fragment>
          {
            vec3 wp = vTwkW * ${scale.toFixed(2)};
            float n1 = twkN(wp * vec3(1.0, 3.2, 1.0));
            float n2 = twkN(wp * 4.1 + 7.3);
            float b = (n1 * 0.65 + n2 * 0.35) - 0.5;
            diffuseColor.rgb *= 1.0 + b * uBrush * 2.0;
            diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(1.04, 1.0, 0.94), smoothstep(0.1, 0.5, b));
          }`)
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += diffuseColor.rgb * uEmissive;');
    };
    m.customProgramCacheKey = () => 'twk' + brush + '_' + scale + (opts.emissiveU ? 'e' : '');
    return m;
  };
  // Ink outline: back faces pushed out along smoothed normals.
  P.ink = (color = 0x3d3633, width = 0.035) => {
    const m = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: true });
    m.onBeforeCompile = sh => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 onormal;')
        .replace('#include <begin_vertex>', `vec3 transformed = vec3(position) + normalize(onormal) * ${width.toFixed(4)};`);
    };
    m.customProgramCacheKey = () => 'ink' + width;
    return m;
  };
  // Smooth normals by position, used only by the outline.
  P.addOutlineNormals = geo => {
    const pos = geo.attributes.position, nor = geo.attributes.normal, n = pos.count;
    const map = new Map(), acc = new Float32Array(n * 3), out = new Float32Array(n * 3);
    const key = i => Math.round(pos.getX(i) * 500) + ',' + Math.round(pos.getY(i) * 500) + ',' + Math.round(pos.getZ(i) * 500);
    for (let i = 0; i < n; i++) {
      const k = key(i); let e = map.get(k); if (!e) { e = [0, 0, 0]; map.set(k, e); }
      e[0] += nor.getX(i); e[1] += nor.getY(i); e[2] += nor.getZ(i);
    }
    for (let i = 0; i < n; i++) { const e = map.get(key(i)); const l = Math.hypot(e[0], e[1], e[2]) || 1; out[i * 3] = e[0] / l; out[i * 3 + 1] = e[1] / l; out[i * 3 + 2] = e[2] / l; }
    geo.setAttribute('onormal', new THREE.BufferAttribute(out, 3));
    return geo;
  };

  // ---------- builder ----------
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color(), _v = new THREE.Vector3(), _n = new THREE.Vector3(), _nm = new THREE.Matrix3();
  class Builder {
    constructor(seed = 1) { this.parts = []; this.rng = makeRng(seed); }
    // place: { p:[x,y,z], r:[x,y,z] (radians), s:[x,y,z]|number }, opts: { jitter, shade (bottom darkening), tint }
    add(geo, color, place = {}, opts = {}) {
      const g = geo.index ? geo.toNonIndexed() : geo.clone();
      if (!g.attributes.normal) g.computeVertexNormals();
      const s = place.s === undefined ? 1 : place.s;
      _s.set(...(Array.isArray(s) ? s : [s, s, s]));
      _e.set(...(place.r || [0, 0, 0]), place.order || 'XYZ'); _q.setFromEuler(_e);
      _p.set(...(place.p || [0, 0, 0]));
      _m.compose(_p, _q, _s);
      if (place.m) _m.premultiply(place.m);
      g.applyMatrix4(_m);
      const jit = opts.jitter || 0;
      if (jit) { const a = g.attributes.position; const cache = new Map(); for (let i = 0; i < a.count; i++) { const k = Math.round(a.getX(i) * 300) + ',' + Math.round(a.getY(i) * 300) + ',' + Math.round(a.getZ(i) * 300); let d = cache.get(k); if (!d) { d = [(this.rng() - 0.5) * jit, (this.rng() - 0.5) * jit, (this.rng() - 0.5) * jit]; cache.set(k, d); } a.setXYZ(i, a.getX(i) + d[0], a.getY(i) + d[1], a.getZ(i) + d[2]); } g.computeVertexNormals(); }
      const pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3);
      _c.set(color);
      const v = opts.vary === undefined ? 0.05 : opts.vary;
      if (v) { const k = 1 + (this.rng() - 0.5) * v * 2; _c.multiplyScalar(k); _c.offsetHSL((this.rng() - 0.5) * v * 0.15, 0, 0); }
      let y0 = Infinity, y1 = -Infinity; for (let i = 0; i < n; i++) { const y = pos.getY(i); if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const shade = opts.shade === undefined ? 0.18 : opts.shade;
      const top = opts.top ? _c2.set(opts.top) : null;
      for (let i = 0; i < n; i++) {
        const t = y1 > y0 ? (pos.getY(i) - y0) / (y1 - y0) : 1;
        const k = 1 - shade * (1 - smooth(t * 1.6));
        let r = _c.r * k, gg = _c.g * k, b = _c.b * k;
        if (top) { const w = smooth((t - 0.6) / 0.4) * (opts.topAmt ?? 0.7); r = lerp(r, top.r, w); gg = lerp(gg, top.g, w); b = lerp(b, top.b, w); }
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color') g.deleteAttribute(k);
      this.parts.push(g);
      return this;
    }
    build() {
      let n = 0; for (const g of this.parts) n += g.attributes.position.count;
      const P3 = new Float32Array(n * 3), N3 = new Float32Array(n * 3), C3 = new Float32Array(n * 3);
      let o = 0;
      for (const g of this.parts) { P3.set(g.attributes.position.array, o * 3); N3.set(g.attributes.normal.array, o * 3); C3.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(P3, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(N3, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(C3, 3));
      geo.computeBoundingSphere();
      this.parts = [];
      return geo;
    }
    // finished mesh, optionally with an ink hull
    mesh(mat, ink, opts = {}) {
      const geo = this.build();
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = opts.cast !== false; m.receiveShadow = opts.receive !== false;
      if (ink) { P.addOutlineNormals(geo); const o = new THREE.Mesh(geo, ink); o.castShadow = false; o.receiveShadow = false; o.renderOrder = -1; m.add(o); }
      return m;
    }
  }
  P.Builder = Builder;

  // ---------- shapes ----------
  P.gearGeo = (r, teeth, thick, opts = {}) => {
    const s = new THREE.Shape(), d = opts.depth ?? r * 0.14, n = teeth;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * TAU, a1 = ((i + 0.22) / n) * TAU, a2 = ((i + 0.5) / n) * TAU, a3 = ((i + 0.72) / n) * TAU;
      const p = (a, rr) => [Math.cos(a) * rr, Math.sin(a) * rr];
      if (i === 0) s.moveTo(...p(a0, r - d));
      s.lineTo(...p(a1, r - d)); s.lineTo(...p(a1 + 0.02, r)); s.lineTo(...p(a2 + 0.03, r)); s.lineTo(...p(a3, r - d)); s.lineTo(...p(((i + 1) / n) * TAU, r - d));
    }
    if (opts.hole) { const h = new THREE.Path(); h.absarc(0, 0, opts.hole, 0, TAU, true); s.holes.push(h); }
    if (opts.windows) {
      const k = opts.windows, ri = opts.hole || r * 0.18, ro = r - d - r * 0.12;
      for (let i = 0; i < k; i++) {
        const a = (i / k) * TAU, w = (TAU / k) * 0.32, h = new THREE.Path();
        h.absarc(0, 0, ro, a - w, a + w, false); h.absarc(0, 0, ri + r * 0.1, a + w * 0.7, a - w * 0.7, true); h.closePath(); s.holes.push(h);
      }
    }
    const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false, curveSegments: 6 });
    g.translate(0, 0, -thick / 2);
    return g;
  };
  // spoked wheel lying in the XY plane, axle along Z
  P.wheel = (b, color, place, r, spokes, thick, opts = {}) => {
    const m = new THREE.Matrix4(); _e.set(...(place.r || [0, 0, 0])); _q.setFromEuler(_e); m.compose(_v.set(...(place.p || [0, 0, 0])), _q, _s.set(1, 1, 1));
    b.add(new THREE.TorusGeometry(r, opts.rim || r * 0.06, 6, Math.max(16, spokes * 4)), color, { m }, opts);
    for (let i = 0; i < Math.ceil(spokes / 2); i++) { const a = (i / spokes) * TAU; b.add(new THREE.BoxGeometry(r * 2 * 0.96, opts.spoke || r * 0.05, thick * 0.6), color, { r: [0, 0, a], m }, Object.assign({ vary: 0.08 }, opts)); }
    b.add(new THREE.CylinderGeometry(opts.hub || r * 0.14, opts.hub || r * 0.14, thick * 1.4, 10), opts.hubColor || color, { r: [Math.PI / 2, 0, 0], m }, opts);
    return b;
  };
  P.tube = (pts, r, seg = 24, rs = 6) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), seg, r, rs, false);
  // A lumpy foliage blob: displaced icosahedron, flattened underneath.
  P.blob = (r, seed = 1, detail = 1, flat = 0.55) => {
    const g = new THREE.IcosahedronGeometry(r, detail), a = g.attributes.position, rng = makeRng(seed);
    const k = []; for (let i = 0; i < 6; i++) k.push([rng.range(-1, 1), rng.range(-1, 1), rng.range(-1, 1), rng.range(0.08, 0.2)]);
    for (let i = 0; i < a.count; i++) {
      _v.set(a.getX(i), a.getY(i), a.getZ(i)); const l = _v.length(); _n.copy(_v).normalize();
      let d = 1; for (const q of k) d += q[3] * Math.max(0, _n.x * q[0] + _n.y * q[1] + _n.z * q[2]);
      _v.setLength(l * d * 0.92); if (_v.y < -r * flat) _v.y = lerp(_v.y, -r * flat, 0.8);
      a.setXYZ(i, _v.x, _v.y, _v.z);
    }
    g.computeVertexNormals();
    return g;
  };
  // tapered irregular stone/plaster column of n sides
  P.tower = (rb, rt, h, sides = 8, seed = 2) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, sides, 4, false), a = g.attributes.position, rng = makeRng(seed);
    for (let i = 0; i < a.count; i++) { const y = a.getY(i); const w = 1 + noise1(y * 1.7 + seed, seed) * 0.025; a.setX(i, a.getX(i) * w + (rng() - 0.5) * 0.02); a.setZ(i, a.getZ(i) * w); }
    g.computeVertexNormals(); return g;
  };

  // ---------- canvas textures ----------
  // Textures are painted on one hidden SDK canvas, then copied out as pixels,
  // so nothing depends on that canvas afterwards (the host may resize it).
  P.canvas = (w, h, draw) => {
    const c = scratch(); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    draw(g, w, h);
    const src = g.getImageData(0, 0, w, h).data, out = new Uint8Array(w * h * 4), row = w * 4;
    for (let y = 0; y < h; y++) out.set(src.subarray(y * row, y * row + row), (h - 1 - y) * row);
    const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
    t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 2; t.needsUpdate = true;
    return t;
  };
  // painted cumulus with a flat, shaded underside
  P.cloudTex = seed => P.canvas(512, 192, (g, w, h) => {
    const r = makeRng(seed * 13 + 1);
    const base = h * 0.74, puffs = [];
    const n = 9 + (r() * 6 | 0);
    for (let i = 0; i < n; i++) { const u = i / (n - 1); const x = w * (0.08 + 0.84 * u) + r.range(-14, 14); const rr = r.range(16, 30) * (1.15 - Math.pow(Math.abs(u - 0.45) * 1.8, 1.6) * 0.7); puffs.push([x, base - rr * r.range(0.35, 0.9), rr]); }
    for (let i = 0; i < 5; i++) { const x = w * r.range(0.25, 0.65); const rr = r.range(26, 44); puffs.push([x, base - rr * r.range(0.9, 1.4), rr]); }
    g.save(); g.beginPath(); g.rect(0, 0, w, base + 2); g.clip();
    // shadowed underside first, then lit tops offset toward the sun
    for (const [x, y, rr] of puffs) { g.fillStyle = 'rgba(206,219,231,1)'; g.beginPath(); g.ellipse(x, y + rr * 0.15, rr * 1.15, rr, 0, 0, TAU); g.fill(); }
    for (const [x, y, rr] of puffs) { const gr = g.createRadialGradient(x - rr * 0.45, y - rr * 0.55, rr * 0.05, x - rr * 0.1, y - rr * 0.1, rr * 1.1); gr.addColorStop(0, 'rgba(255,255,251,1)'); gr.addColorStop(0.55, 'rgba(250,250,248,0.95)'); gr.addColorStop(1, 'rgba(232,238,244,0)'); g.fillStyle = gr; g.beginPath(); g.ellipse(x - rr * 0.08, y - rr * 0.12, rr * 1.05, rr * 0.92, 0, 0, TAU); g.fill(); }
    g.restore();
    // a soft flat base and a few brush flecks
    const bg = g.createLinearGradient(0, base - 10, 0, base + 3); bg.addColorStop(0, 'rgba(214,226,236,0)'); bg.addColorStop(1, 'rgba(206,220,233,0.95)');
    g.fillStyle = bg; g.fillRect(w * 0.1, base - 10, w * 0.8, 13);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 60; i++) { g.fillStyle = 'rgba(0,0,0,' + r.range(0.05, 0.25) + ')'; g.fillRect(r.range(0, w), r.range(0, h), r.range(4, 16), 1.5); }
    g.globalCompositeOperation = 'source-over';
  });
  // a distant silhouette layer: hills, spires, towers. Drawn once.
  P.ridgeTex = (seed, kind) => P.canvas(1024, 256, (g, w, h) => {
    const r = makeRng(seed);
    g.fillStyle = '#fff';
    g.beginPath(); g.moveTo(0, h);
    if (kind === 'hills') { for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.55 - (noise1(x / 160, seed) * 0.5 + 0.5) * h * 0.35 - noise1(x / 41, seed + 3) * h * 0.04); }
    else if (kind === 'spires') {
      let x = 0; g.lineTo(0, h * 0.8);
      while (x < w) { const sw = r.range(40, 120), sh = r.range(0.25, 0.8); const xm = x + sw / 2; g.lineTo(x + sw * 0.15, h * (1 - sh * 0.5)); g.quadraticCurveTo(xm - sw * 0.3, h * (1 - sh), xm, h * (1 - sh) + 4); g.quadraticCurveTo(xm + sw * 0.3, h * (1 - sh), x + sw * 0.85, h * (1 - sh * 0.5)); g.lineTo(x + sw, h * 0.8); x += sw + r.range(20, 140); }
      g.lineTo(w, h * 0.8);
    } else { // town: roofs, a far windmill, a tower
      for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.78 - noise1(x / 200, seed) * h * 0.06);
      g.lineTo(w, h); g.closePath(); g.fill(); g.beginPath();
      let x = 30;
      while (x < w - 40) {
        const bw = r.range(20, 46), bh = r.range(22, 60), y = h * 0.78 - noise1(x / 200, seed) * h * 0.06;
        g.moveTo(x, y); g.lineTo(x, y - bh); g.lineTo(x + bw / 2, y - bh - bw * 0.45); g.lineTo(x + bw, y - bh); g.lineTo(x + bw, y); g.closePath();
        if (r() < 0.18) { g.rect(x + bw * 0.3, y - bh - bw * 1.6, bw * 0.4, bw * 1.2); }
        x += bw + r.range(4, 70);
      }
    }
    g.lineTo(w, h); g.closePath(); g.fill();
  });
  // soft round glow for tiny lights and motes
  P.dotTex = P.canvas(64, 64, (g, w) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); });
  return P;
}
