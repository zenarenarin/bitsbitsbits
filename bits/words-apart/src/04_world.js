// THE DESCENT: one continuous underground world, built from a few reusable pieces
// (displaced rock, cut stone, slabs, cables) and placed by hand-tuned rules per zone.
//
// Vertical layout (metres, the figure's feet at each puzzle):
//   Zone 1  the surface      y =    0   rough shaft under a narrow opening, a column of green light
//   Zone 2  upper chamber    y =  -70   dressed stone, ledges, niche grids, a colossal bracket
//   Zone 3  the midpoint     y = -150   a cavern: bridges, hanging formations, portals, terraced floor
//   Zone 4  the deep end     y = -235   a tight passage of pillars with light in the cracks
//   Zone 5  final chamber    y = -330   hanging beneath a coffered vault; the floor is far below
//   Finale                   y = -408.2 the slab lands on a dais facing a monolith of pale light
const STOPS = [0, -70, -150, -235, -330];
const MONO_TH_CONST = 4.25;
const FINAL_Y = -408.2;
const PAL = {
  void: '#060807', fog: '#080b09', stone: '#5b605a', stoneDark: '#3b403b', stoneWarm: '#686459', moss: '#4f5d4c',
  green: '#a1c58e', greenMuted: '#64866a', white: '#e9e2cf', warm: '#f1e4c4'
};

function createWorld(THREE, renderer, quality) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(PAL.void);
  scene.fog = new THREE.FogExp2(PAL.fog, 0.016);
  const disposables = [];
  const keep = x => { disposables.push(x); return x; };

  // ---------- materials ----------
  const shared = { uRim: { value: new THREE.Color(PAL.green) }, uRimStr: { value: 0.22 }, uTime: { value: 0 } };
  const NOISE_GLSL = `
    varying vec3 vWPos;
    uniform vec3 uRim; uniform float uRimStr;
    float waHash(vec3 p){ p = fract(p*0.3183099+0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    float waNoise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
      return mix(mix(mix(waHash(i),waHash(i+vec3(1,0,0)),f.x),mix(waHash(i+vec3(0,1,0)),waHash(i+vec3(1,1,0)),f.x),f.y),
                 mix(mix(waHash(i+vec3(0,0,1)),waHash(i+vec3(1,0,1)),f.x),mix(waHash(i+vec3(0,1,1)),waHash(i+vec3(1,1,1)),f.x),f.y),f.z); }`;
  function stoneMat(color, o) {
    o = o || {};
    const m = new THREE.MeshStandardMaterial({ color, roughness: o.rough != null ? o.rough : 0.94, metalness: 0, flatShading: !!o.flat, vertexColors: !!o.vc });
    const strata = o.strata != null ? o.strata : 1, moss = o.moss != null ? o.moss : 0.6, rim = o.rim != null ? o.rim : 1, scale = o.scale || 1;
    m.onBeforeCompile = sh => {
      sh.uniforms.uRim = shared.uRim; sh.uniforms.uRimStr = shared.uRimStr;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', `#include <project_vertex>
          vec4 waWP = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            waWP = instanceMatrix * waWP;
          #endif
          vWPos = (modelMatrix * waWP).xyz;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
        .replace('#include <color_fragment>', `#include <color_fragment>
          vec3 wq = vWPos * ${scale.toFixed(2)};
          float n1 = waNoise(wq*0.07), n2 = waNoise(wq*0.55), n3 = waNoise(wq*2.9);
          float band = abs(fract(wq.y*0.21 + n1*0.9) - 0.5);
          float strata = smoothstep(0.42, 0.5, band);
          diffuseColor.rgb *= 0.74 + 0.36*n1 + 0.14*n2 + 0.08*n3 - 0.10*strata*${strata.toFixed(2)};
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(0.86,1.06,0.86), smoothstep(0.5,0.8,n1)*${moss.toFixed(2)});`)
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
          roughnessFactor = clamp(roughnessFactor - 0.12*n3*n2, 0.55, 1.0);`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float waFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
          totalEmissiveRadiance += uRim * waFres * uRimStr * ${rim.toFixed(2)} * (0.55 + 0.6*n2);`);
    };
    m.customProgramCacheKey = () => 'wa-stone-' + [strata, moss, rim, scale, !!o.flat, !!o.vc].join('-');
    return keep(m);
  }
  const M = {
    rock: stoneMat(PAL.stoneDark, { flat: true, vc: true, moss: 0.8 }),
    cut: stoneMat(PAL.stone, { strata: 0.3, moss: 0.5 }),
    warm: stoneMat(PAL.stoneWarm, { strata: 0.2, moss: 0.2 }),
    dark: stoneMat('#262a27', { strata: 0.6, moss: 0.3, rim: 0.6 }),
    figure: new THREE.MeshStandardMaterial({ color: '#0c0f0d', roughness: 1 }),
    cable: new THREE.MeshStandardMaterial({ color: '#1b1f1c', roughness: 0.7, metalness: 0.3 }),
    niche: new THREE.MeshBasicMaterial({ color: '#030404' }),
    glow: new THREE.MeshBasicMaterial({ color: PAL.green, fog: true }),
    glowDim: new THREE.MeshBasicMaterial({ color: '#6f9a68', fog: true }),
    slit: new THREE.MeshBasicMaterial({ color: PAL.warm, fog: false, transparent: true, opacity: 0.15 }),
    lantern: new THREE.MeshBasicMaterial({ color: '#d9efc6' })
  };
  for (const k of ['figure', 'cable', 'niche', 'glow', 'glowDim', 'slit', 'lantern']) keep(M[k]);

  // ---------- reusable geometry ----------
  const rng = makeRng(20261110);
  const R = (a, b) => a + (b - a) * rng();
  function vnoise3(x, y, z, seed) { // cheap smooth value noise for vertex displacement
    const h = (i, j, k) => { let n = (i * 374761393 + j * 668265263 + k * 2147483647 + seed * 974711) | 0; n = (n ^ (n >> 13)) * 1274126177; return ((n ^ (n >> 16)) >>> 0) / 4294967296; };
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), xf = x - xi, yf = y - yi, zf = z - zi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
    const L = (a, b, t) => a + (b - a) * t;
    return L(L(L(h(xi, yi, zi), h(xi + 1, yi, zi), u), L(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
      L(L(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), L(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v), w);
  }
  // A rock: a subdivided box, chiselled by noise into a few large planes (not a lumpy blob).
  function rockGeo(seed) {
    const g = new THREE.BoxGeometry(1, 1, 1, 3, 5, 3), p = g.attributes.position, col = [];
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const n = vnoise3(x * 2.2 + 9, y * 1.6, z * 2.2, seed) - 0.5, n2 = vnoise3(x * 5 + 3, y * 5, z * 5, seed + 7) - 0.5;
      const k = 1 + n * 0.42 + n2 * 0.12;
      x *= k; z *= k; y *= 1 + n2 * 0.12;
      x += (vnoise3(y * 1.3, seed, 2, seed) - 0.5) * 0.25;
      p.setXYZ(i, x, y, z);
      const ao = 0.5 + 0.5 * smooth((y + 0.5) * 1.1) + n * 0.25; col.push(ao, ao, ao);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return keep(g);
  }
  const G = {
    rocks: [rockGeo(1), rockGeo(2), rockGeo(3), rockGeo(4)],
    box: keep(new THREE.BoxGeometry(1, 1, 1)),
    obelisk: keep(new THREE.OctahedronGeometry(1, 0))
  };
  G.obelisk.scale(1, 1, 1);

  // Instanced batches: one draw call per (geometry, material) pair.
  const batches = new Map();
  function put(geo, mat, x, y, z, sx, sy, sz, ry, rx, rz, shade, opts) {
    const key = geo.uuid + mat.uuid + (opts && opts.noShadow ? 'n' : '');
    let b = batches.get(key); if (!b) { b = { geo, mat, list: [], recv: !(opts && opts.noShadow) }; batches.set(key, b); }
    b.list.push([x, y, z, sx, sy, sz, ry || 0, rx || 0, rz || 0, shade == null ? 1 : shade]);
  }
  function flush() {
    const o = new THREE.Object3D(), c = new THREE.Color();
    for (const b of batches.values()) {
      const im = new THREE.InstancedMesh(b.geo, b.mat, b.list.length);
      b.list.forEach((e, i) => {
        o.position.set(e[0], e[1], e[2]); o.scale.set(e[3], e[4], e[5]); o.rotation.set(e[7], e[6], e[8], 'YXZ'); o.updateMatrix();
        im.setMatrixAt(i, o.matrix); c.setScalar(e[9]); im.setColorAt(i, c);
      });
      im.receiveShadow = b.recv; im.castShadow = false;
      im.computeBoundingSphere(); scene.add(im);
    }
    batches.clear();
  }
  const polar = (r, th) => [Math.cos(th) * r, Math.sin(th) * r];
  // place a block whose inner face sits at radius r, facing the shaft axis
  function ring(geo, mat, r, th, y, w, h, d, shade, tilt, opts) {
    const [x, z] = polar(r + d / 2, th);
    put(geo, mat, x, y, z, w, h, d, -th + Math.PI / 2, tilt || 0, 0, shade, opts);
  }
  const rock = () => G.rocks[Math.floor(rng() * 4)];

  // ---------- ZONE 1: the opening and the rough upper shaft ----------
  // the aperture: rocks crowd in and lean over the void
  for (let y = 40; y <= 78; y += 5.5) {
    const t = (y - 40) / 38, r = lerp(14, 6.2, Math.pow(t, 0.7)), n = Math.round(lerp(13, 9, t));
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + R(-0.2, 0.2) + y * 0.13;
      ring(rock(), M.rock, r + R(-0.8, 1.6), th, y + R(-1.5, 1.5), R(5, 8), R(6, 10), R(6, 9), R(0.55, 0.95), R(-0.35, -0.1));
    }
  }
  // rough walls, y 40 → -45
  for (let y = 38; y >= -48; y -= 6.5) {
    const n = 15;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + R(-0.12, 0.12) + y * 0.05;
      ring(rock(), M.rock, R(15.5, 18), th, y + R(-1.5, 1.5), R(6.5, 9.5), R(8, 14), R(6, 9), R(0.6, 1.05), R(-0.08, 0.08));
    }
  }
  // a fallen monolith wedged across one side of the shaft
  put(G.box, M.cut, -11.5, -22, 6.5, 2.4, 34, 3.2, 0.4, 0, 0.62, 0.9);
  put(G.box, M.cut, 12.4, 18, -6, 2.0, 22, 2.6, -0.9, 0, -0.18, 0.85);
  // the spiral stair carved into the wall: one long thread from the surface down to the upper chamber
  for (let k = 0; k < 150; k++) {
    const th = 2.2 + k * 0.105, y = 6 - k * 0.62;
    ring(G.box, M.cut, 13.8, th, y, 1.7, 0.5, 2.6, 0.95);
    if (k % 12 === 0) ring(G.box, M.cut, 13.6, th, y + 0.9, 0.25, 1.6, 0.25, 0.8);
  }
  // the beam bridging the opening, from which the slab hangs
  put(G.box, M.cut, 0, 60, 0, 30, 2.4, 3.8, 0.12, 0, 0, 0.8);
  put(G.box, M.cut, 0, 62.4, 0, 4.6, 2.6, 4.6, 0.12, 0, 0, 0.7);

  // ---------- ZONE 2: the upper chamber of dressed stone ----------
  const Z2_TOP = -45, Z2_BOT = -112;
  for (let y = Z2_TOP; y >= Z2_BOT; y -= 4.6) {
    const n = 18;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + ((Math.round(y / 4.6) & 1) ? Math.PI / n : 0);
      ring(G.box, M.cut, 15.5 + R(0, 0.7), th, y, 5.6, 4.5, 4, R(0.7, 1.0));
    }
  }
  for (let y of [-58, -82, -104]) { // cornices: narrow ledges that read as strata of an old building
    for (let i = 0; i < 24; i++) ring(G.box, M.cut, 14.3, (i / 24) * Math.PI * 2, y, 4.1, 0.7, 1.4, 0.95);
  }
  for (let i = 0; i < 8; i++) { // pilasters
    const th = (i / 8) * Math.PI * 2 + 0.2;
    ring(G.box, M.cut, 14.6, th, (Z2_TOP + Z2_BOT) / 2, 1.8, Z2_BOT - Z2_TOP - 4, 1.2, 0.9);
  }
  // niche grids: rows of dark openings, a few lit from within
  const nicheGrid = (th0, yTop, cols, rows) => {
    for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
      const th = th0 + (c - cols / 2) * 0.085, y = yTop - r * 2.6, lit = rng() < 0.1;
      ring(G.box, lit ? M.glowDim : M.niche, 15.4, th, y, 0.7, 1.5, 0.12, 1, 0, { noShadow: true });
    }
  };
  nicheGrid(3.4, -62, 9, 6); nicheGrid(5.3, -86, 7, 5); nicheGrid(0.2, -88, 6, 6);
  // the colossal bracket: an inverted stepped mass the camera passes in transition 2
  for (let s = 0; s < 7; s++) {
    const y = -90 - s * 3.6, reach = 2 + s * 0.85;
    ring(G.box, M.cut, 15.2 - reach, 1.05, y, 7.5 - s * 0.35, 3.6, reach + 1, 0.85 - s * 0.03);
  }
  ring(G.box, M.dark, 9.4, 1.05, -117, 3.2, 5, 4, 0.9);

  // ---------- the cavern ceiling ----------
  for (let rr = 15; rr < 60; rr += 7) {
    const n = Math.round(rr * 0.9);
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + rr;
      ring(rock(), M.rock, rr, th, -118 + R(-1.5, 2) - (rr - 15) * 0.05, (Math.PI * 2 * rr / n) * 1.25, R(7, 11), 7.5, R(0.45, 0.8));
    }
  }

  // ---------- ZONE 3: the cavern ----------
  for (let y = -122; y >= -226; y -= 9) {
    const n = 26;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + R(-0.06, 0.06) + y;
      ring(rock(), M.rock, R(52, 57), th, y + R(-2, 2), R(13, 18), R(12, 18), R(8, 12), R(0.45, 0.85));
    }
  }
  // portals: tall dark openings in the cavern wall, faintly lit beyond
  const portals = [0.3, 1.35, 2.5, 3.55, 4.55, 5.6];
  portals.forEach((th, i) => {
    const y = -170 - (i % 3) * 7, h = 22 + (i % 2) * 6;
    ring(G.box, M.cut, 49, th - 0.075, y, 3, h, 4, 0.8); ring(G.box, M.cut, 49, th + 0.075, y, 3, h, 4, 0.8);
    ring(G.box, M.cut, 49, th, y + h / 2 + 1.5, 11, 3, 4.5, 0.75);
    ring(G.box, M.glowDim, 53.5, th, y, 4.5, h - 1, 0.4, 1, 0, { noShadow: true });
  });
  // terraces stepping around the cavern wall
  for (let k = 0; k < 4; k++) {
    const y = -146 - k * 15, th0 = k * 1.7, span = 2.2;
    for (let i = 0; i < 20; i++) ring(G.box, M.cut, 45 + k * 1.2, th0 + (i / 20) * span, y, 4.6, 1.4, 7 - k, 0.85);
  }
  // bridges: long chords across the cavern, carried on deep arched piers
  const bridge = (y, th, off, len) => {
    const dx = Math.cos(th), dz = Math.sin(th), nx = -dz, nz = dx;
    const cx = nx * off, cz = nz * off, ry = -th;
    put(G.box, M.cut, cx, y, cz, len, 1.4, 3, ry, 0, 0, 0.9);
    put(G.box, M.cut, cx, y + 0.9, cz + 0, len, 0.4, 0.3, ry, 0, 0, 0.8);
    const piers = Math.floor(len / 9);
    for (let i = 1; i < piers; i++) {
      const t = i / piers - 0.5, px = cx + dx * t * len, pz = cz + dz * t * len;
      put(G.box, M.cut, px, y - 4.5, pz, 1.4, 8, 2.6, ry, 0, 0, 0.75);
    }
  };
  bridge(-171, 0.25, 15, 104); bridge(-190, 2.05, -21, 96); bridge(-206, 4.0, 12, 106);
  // hanging formations: inverted stepped pyramids and long obelisks on cables
  const hang = (th, r, yTop, steps, size) => {
    const [x, z] = polar(r, th);
    put(G.box, M.cable, x, yTop + 6, z, 0.12, 12, 0.12, 0, 0, 0, 1, { noShadow: true });
    for (let s = 0; s < steps; s++) { const w = size * (1 - s / steps) + 0.6; put(G.box, M.cut, x, yTop - s * 1.7, z, w, 1.7, w, th, 0, 0, 0.8 - s * 0.04); }
  };
  hang(0.9, 27, -124, 6, 7); hang(2.8, 34, -126, 5, 6); hang(4.6, 24, -125, 7, 8); hang(5.7, 38, -124, 4, 5);
  [[1.9, 30, 16], [3.9, 22, 22], [5.2, 33, 14]].forEach(([th, r, len]) => {
    const [x, z] = polar(r, th);
    put(G.obelisk, M.dark, x, -122 - len, z, 1.6, len, 1.6, th, 0, 0, 1);
  });
  // the terraced floor: concentric rings stepping down to the mouth of the passage
  for (let k = 0; k < 8; k++) {
    const rr = 13 + k * 5, y = -226 + k * 2.4, n = Math.round(rr * 1.1);
    for (let i = 0; i < n; i++) ring(G.box, k % 2 ? M.cut : M.warm, rr, (i / n) * Math.PI * 2 + k * 0.1, y, (Math.PI * 2 * rr / n) * 1.04, 2.6 + k * 0.2, 5.6, 0.75 + (k % 3) * 0.06);
  }

  // ---------- ZONE 4: the narrow passage ----------
  const crackTh = [0.6, 1.9, 3.3, 4.4, 5.6];
  for (let y = -230; y >= -306; y -= 7) {
    const n = 16;
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2;
      if (crackTh.some(c => Math.abs(((th - c + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.1)) continue; // leave the cracks open
      ring(G.box, M.dark, 13 + R(0, 0.6), th, y, 5, 7, 5, R(0.65, 0.95));
    }
    if (Math.round(y) % 21 === -230 % 21) for (let i = 0; i < 16; i++) ring(G.box, M.cut, 12.3, (i / 16) * Math.PI * 2, y + 3.4, 5, 0.6, 1.2, 0.9);
  }
  for (const th of crackTh) { // light behind each crack
    ring(G.box, M.glow, 16.5, th, -268, 2.2, 76, 0.3, 1, 0, { noShadow: true });
    ring(G.box, M.dark, 17.2, th, -268, 8, 80, 2, 0.6);
  }
  for (let i = 0; i < 12; i++) { // tall pillars pressing in
    const th = (i / 12) * Math.PI * 2 + 0.26;
    ring(G.box, M.cut, 11.6, th, -268, 1.1, 78, 1.1, 0.8);
  }

  // ---------- ZONE 5: the final chamber ----------
  const CH_TOP = -310, CH_FLOOR = -420, CH_R = 128;
  for (let rr = 13; rr < CH_R + 20; rr += 10) { // the vault
    const n = Math.round(rr * 0.8);
    for (let i = 0; i < n; i++) ring(rock(), M.rock, rr, (i / n) * Math.PI * 2 + rr, CH_TOP + R(-1, 3), (Math.PI * 2 * rr / n) * 1.25, R(8, 12), 10.5, R(0.4, 0.7));
  }
  for (let i = 0; i < 32; i++) { // coffers: radial ribs and rings under the vault
    const th = (i / 32) * Math.PI * 2, len = CH_R - 14, [x, z] = polar(14 + len / 2, th);
    put(G.box, M.cut, x, CH_TOP - 7, z, len, 2.2, 1.6, -th, 0, 0, 0.75);
  }
  for (const rr of [24, 52, 84, 116]) { const n = Math.round(rr * 0.5); for (let i = 0; i < n; i++) ring(G.box, M.cut, rr, (i / n) * Math.PI * 2, CH_TOP - 7.4, (Math.PI * 2 * rr / n) * 1.02, 2.6, 2, 0.7); }
  for (let i = 0; i < 40; i++) { // colossal colonnade
    const th = (i / 40) * Math.PI * 2;
    ring(G.box, M.cut, CH_R - 8, th, (CH_TOP + CH_FLOOR) / 2, 6, CH_TOP - CH_FLOOR, 6, 0.85);
    ring(rock(), M.rock, CH_R + 4, th + 0.08, (CH_TOP + CH_FLOOR) / 2, 18, CH_TOP - CH_FLOOR + 10, 10, 0.5);
  }
  for (let i = 0; i < 10; i++) { // standing stones around the dais
    const th = (i / 10) * Math.PI * 2 + 0.31, h = 9 + (i % 3) * 4;
    ring(G.box, M.cut, 58, th, CH_FLOOR + h / 2, 2.4, h, 2.4, 0.85);
  }
  // the floor: a single large slab with an incised grid
  const floorMat = stoneMat('#4a4e48', { strata: 0, moss: 0.3, rim: 0.2 });
  floorMat.onBeforeCompile = (prev => sh => {
    prev(sh);
    sh.fragmentShader = sh.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      vec2 gq = abs(fract(vWPos.xz / 8.0) - 0.5);
      float gl = smoothstep(0.47, 0.495, max(gq.x, gq.y));
      diffuseColor.rgb *= 1.0 - 0.55*gl;`);
  })(floorMat.onBeforeCompile);
  floorMat.customProgramCacheKey = () => 'wa-floor';
  const floor = new THREE.Mesh(keep(new THREE.CircleGeometry(CH_R + 10, 96)), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.position.y = CH_FLOOR; floor.receiveShadow = true; scene.add(floor);
  // the dais
  [[34, 2], [26, 2], [18, 2], [10, 3.2]].reduce((y, [s, h]) => { put(G.box, M.warm, 0, y + h / 2, 0, s, h, s, 0.785, 0, 0, 0.9); return y + h; }, CH_FLOOR);
  // (dais top: CH_FLOOR + 9.2 = -410.8; the slab, 2.6 m deep under the figure's feet, comes to rest on it)
  // the monolith of pale light, and the causeway that leads to it
  const MONO_R = 46, MONO_TH = MONO_TH_CONST;
  const [mx, mz] = polar(MONO_R, MONO_TH);
  const monolith = new THREE.Group(); monolith.position.set(mx, CH_FLOOR, mz); monolith.rotation.y = -MONO_TH - Math.PI / 2; scene.add(monolith);
  const monoBody = new THREE.Mesh(G.box, M.dark); monoBody.scale.set(16, 74, 7); monoBody.position.y = 37; monoBody.receiveShadow = true; monolith.add(monoBody);
  const slit = new THREE.Mesh(G.box, M.slit); slit.scale.set(0.9, 52, 0.4); slit.position.set(0, 32, 3.55); monolith.add(slit);
  const halo = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 1)), keep(new THREE.MeshBasicMaterial({ color: PAL.warm, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
  halo.scale.set(22, 70, 1); halo.position.set(0, 32, 3.9); monolith.add(halo);
  for (let s = 0; s < 3; s++) { const b = new THREE.Mesh(G.box, M.cut); b.scale.set(22 - s * 3, 2, 11 - s * 2); b.position.y = 1 + s * 2 - 6 + 5; monolith.add(b); }
  {
    const len = MONO_R - 20, [cx, cz] = polar(17 + len / 2, MONO_TH);
    put(G.box, M.warm, cx, CH_FLOOR + 1, cz, len, 2, 6, -MONO_TH, 0, 0, 0.85);
  }
  // grid-snapped block masses (an inverted skyline hanging from the vault, a rising one on the floor):
  // squares of slightly different value, like a city drawn on graph paper
  const blockMat = stoneMat('#53584f', { strata: 0, moss: 0.15, rim: 0.7, scale: 0.5 });
  const CELL = 6;
  for (let gx = -20; gx <= 20; gx++) for (let gz = -20; gz <= 20; gz++) {
    const x = gx * CELL, z = gz * CELL, d = Math.hypot(x, z);
    if (d < 30 || d > CH_R - 16) continue;
    const n = vnoise3(gx * 0.18, 3, gz * 0.18, 11), n2 = vnoise3(gx * 0.5, 7, gz * 0.5, 5);
    const hang = Math.floor(Math.max(0, n - 0.42) * 22 * (0.6 + n2));
    for (let k = 0; k < hang; k++) put(G.box, blockMat, x, CH_TOP - 9 - k * CELL - CELL / 2, z, CELL, CELL, CELL, 0, 0, 0, 0.55 + 0.45 * vnoise3(gx, k, gz, 3));
    const ang = Math.atan2(z, x), away = Math.abs(((ang - MONO_TH_CONST + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    const rise = away < 0.5 && d < 70 ? 0 : Math.floor(Math.max(0, vnoise3(gx * 0.22, 9, gz * 0.22, 21) - 0.5) * 16 * (0.5 + n2));
    for (let k = 0; k < rise; k++) put(G.box, blockMat, x, CH_FLOOR + k * CELL + CELL / 2, z, CELL, CELL, CELL, 0, 0, 0, 0.5 + 0.5 * vnoise3(gx, k + 9, gz, 4));
  }
  flush();

  // watchers: a few pairs of pale eyes deep in the dark, almost never noticed, slowly blinking
  const eyeGeo = keep(new THREE.CircleGeometry(1, 16)); eyeGeo.scale(1, 0.42, 1);
  const eyeMat = keep(new THREE.MeshBasicMaterial({ color: '#9fbf8c', transparent: true, opacity: 0.0, fog: false, depthWrite: false }));
  const eyes = [];
  [[-128, 0.9, 30], [-165, 3.1, 44], [-196, 5.0, 46], [-250, 2.6, 19], [-282, 4.9, 19]].forEach(([y, th, r], i) => {
    const g = new THREE.Group(), [x, z] = polar(r, th);
    g.position.set(x, y, z); g.lookAt(0, y, 0);
    for (const sx of [-0.9, 0.9]) { const e = new THREE.Mesh(eyeGeo, eyeMat); e.position.x = sx; e.scale.setScalar(0.32); g.add(e); }
    g.userData.phase = i * 2.3; scene.add(g); eyes.push(g);
  });

  // ---------- light ----------
  const hemi = new THREE.HemisphereLight('#4f6153', '#050605', 0.3); scene.add(hemi);
  const key = new THREE.SpotLight('#c4dcb2', 6, 0, 0.075, 0.35, 0);
  key.position.set(0, 96, 0); key.castShadow = true;
  key.shadow.mapSize.set(quality.shadow, quality.shadow); key.shadow.camera.near = 20; key.shadow.camera.far = 560; key.shadow.bias = -0.0006; key.shadow.normalBias = 0.03;
  scene.add(key); scene.add(key.target);
  // light from above: catches every ledge, step and slab top, leaves the walls in shadow
  const fill = new THREE.DirectionalLight('#9dbb8c', 0.5); fill.position.set(6, 100, 10); scene.add(fill); scene.add(fill.target);
  const lanternLight = new THREE.PointLight('#cfe8b5', 3, 16, 1.3); scene.add(lanternLight);
  const crackLights = [
    new THREE.PointLight(PAL.green, 0, 70, 1.2), new THREE.PointLight(PAL.green, 0, 60, 1.2), new THREE.PointLight(PAL.green, 0, 30, 1.4)
  ];
  crackLights[0].position.set(...(([x, z]) => [x, -172, z])(polar(47, portals[1])));
  crackLights[1].position.set(...(([x, z]) => [x, -180, z])(polar(47, portals[4])));
  crackLights[2].position.set(0, -262, 0);
  crackLights.forEach(l => scene.add(l));
  const finalLight = new THREE.PointLight(PAL.warm, 0, 260, 0.9);
  { const [x, z] = polar(MONO_R - 6, MONO_TH); finalLight.position.set(x, CH_FLOOR + 34, z); }
  scene.add(finalLight);

  // the sky beyond the opening
  const sky = new THREE.Mesh(keep(new THREE.CircleGeometry(40, 48)), keep(new THREE.MeshBasicMaterial({ color: '#c9dcb8', fog: false })));
  sky.rotation.x = Math.PI / 2; sky.position.y = 104; scene.add(sky);

  // ---------- light columns (soft volumetric look; additive, no depth write) ----------
  function columnMat(color, top, fadeTo, strength) {
    return keep(new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uTop: { value: top }, uFade: { value: fadeTo }, uStr: { value: strength }, uTime: shared.uTime },
      vertexShader: `varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uTop, uFade, uStr, uTime; varying vec3 vW; varying vec3 vN;
        float h(float n){ return fract(sin(n)*43758.5453); }
        void main(){
          vec3 V = normalize(cameraPosition - vW);
          float facing = abs(dot(normalize(vN), V));
          float core = mix(0.55, 1.0, pow(facing, 1.5));
          float st = fract(sin(dot(floor(gl_FragCoord.xy*0.5), vec2(12.9898,78.233)))*43758.5453);
          core *= 0.86 + 0.28*st;
          float y = clamp((uTop - vW.y) / (uTop - uFade), 0.0, 1.0);
          float fall = pow(1.0 - y, 1.6);
          float dust = 0.82 + 0.18*sin(vW.y*0.9 + uTime*0.6 + sin(vW.y*0.13 - uTime*0.2)*4.0);
          gl_FragColor = vec4(uColor * core * fall * dust * uStr, 1.0);
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide
    }));
  }
  // a hard-edged, square column of light, like a doorway cut into the dark; a faint halo around it
  const colMat = columnMat('#86b07f', 100, -170, 0.22), colMat2 = columnMat('#a9cf98', 100, -120, 0.42);
  colMat2.side = THREE.FrontSide; colMat.side = THREE.FrontSide;
  const column = new THREE.Mesh(keep(new THREE.BoxGeometry(5.2, 260, 5.2)), colMat); column.position.y = 100 - 130; scene.add(column);
  const column2 = new THREE.Mesh(keep(new THREE.BoxGeometry(3.3, 260, 3.3)), colMat2); column2.position.y = 100 - 130; scene.add(column2);
  const finaleBeamMat = columnMat(PAL.warm, CH_TOP, CH_FLOOR + 74, 0);
  finaleBeamMat.uniforms.uTop.value = CH_FLOOR + 74; finaleBeamMat.uniforms.uFade.value = CH_TOP + 10;
  const finaleBeam = new THREE.Mesh(keep(new THREE.CylinderGeometry(1.4, 2.2, CH_TOP - CH_FLOOR - 74 + 200, 24, 1, true)), finaleBeamMat);
  finaleBeam.position.set(mx, CH_FLOOR + 74 + (CH_TOP - CH_FLOOR - 74 + 200) / 2, mz); scene.add(finaleBeam);
  // fix the beam's own fade to rise upward: brightest at the monolith top
  finaleBeamMat.fragmentShader = finaleBeamMat.fragmentShader.replace('float y = clamp((uTop - vW.y) / (uTop - uFade), 0.0, 1.0);', 'float y = clamp((vW.y - uTop) / (uFade - uTop), 0.0, 1.0);');

  // ---------- the slab, its cables, and the traveller ----------
  const slab = new THREE.Group(); scene.add(slab);
  const slabMat = stoneMat('#34372f', { strata: 0.2, moss: 0.3 });
  const slabBody = new THREE.Mesh(G.box, slabMat); slabBody.scale.set(3.4, 2.6, 3.4); slabBody.position.y = -1.3; slabBody.castShadow = slabBody.receiveShadow = true; slab.add(slabBody);
  const slabLip = new THREE.Mesh(G.box, M.cut); slabLip.scale.set(3.7, 0.35, 3.7); slabLip.position.y = -0.2; slabLip.receiveShadow = true; slab.add(slabLip);
  const cables = [];
  for (const [cx, cz] of [[-1.55, -1.55], [1.55, -1.55], [-1.55, 1.55], [1.55, 1.55]]) {
    const c = new THREE.Mesh(G.box, M.cable); c.userData.off = [cx, cz]; scene.add(c); cables.push(c);
    const post = new THREE.Mesh(G.box, M.cut); post.scale.set(0.22, 0.5, 0.22); post.position.set(cx, 0.1, cz); slab.add(post);
  }
  const fig = new THREE.Group(); slab.add(fig); fig.position.set(-0.35, 0, 0.2);
  const body = new THREE.Group(); fig.add(body);
  const cloak = new THREE.Mesh(keep(new THREE.LatheGeometry([[0, 0], [0.33, 0], [0.315, 0.12], [0.27, 0.6], [0.215, 1.0], [0.19, 1.22], [0.14, 1.36], [0.05, 1.42], [0, 1.43]].map(([x, y]) => new THREE.Vector2(x, y)), 12)), M.figure);
  cloak.castShadow = true; body.add(cloak);
  const hood = new THREE.Mesh(keep(new THREE.ConeGeometry(0.17, 0.5, 10)), M.figure); hood.position.set(0.03, 1.58, 0); hood.rotation.z = -0.22; hood.castShadow = true; body.add(hood);
  const arm = new THREE.Mesh(G.box, M.figure); arm.scale.set(0.09, 0.55, 0.09); arm.position.set(0.25, 1.05, 0.05); arm.rotation.z = 0.6; body.add(arm);
  const staffPivot = new THREE.Group(); staffPivot.position.set(0.42, 0.9, 0.06); body.add(staffPivot);
  const staff = new THREE.Mesh(G.box, M.figure); staff.scale.set(0.04, 2.15, 0.04); staff.position.y = 0.17; staff.castShadow = true; staffPivot.add(staff);
  const hook = new THREE.Mesh(G.box, M.figure); hook.scale.set(0.32, 0.035, 0.035); hook.position.set(0.14, 1.23, 0); staffPivot.add(hook);
  const lanternPivot = new THREE.Group(); lanternPivot.position.set(0.28, 1.22, 0); staffPivot.add(lanternPivot);
  const cord = new THREE.Mesh(G.box, M.figure); cord.scale.set(0.012, 0.22, 0.012); cord.position.y = -0.11; lanternPivot.add(cord);
  const lantern = new THREE.Mesh(G.box, M.lantern); lantern.scale.set(0.1, 0.15, 0.1); lantern.position.y = -0.3; lanternPivot.add(lantern);
  const lanternCap = new THREE.Mesh(keep(new THREE.ConeGeometry(0.1, 0.08, 4)), M.figure); lanternCap.position.y = -0.2; lanternCap.rotation.y = Math.PI / 4; lanternPivot.add(lanternCap);
  const lanternGlow = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: keep(glowTexture(THREE)), color: '#cfe8b5', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })));
  lantern.add(lanternGlow); lanternGlow.scale.set(9, 6, 1);

  // ---------- drifting motes near the camera ----------
  const MOTES = quality.motes, mg = new THREE.BufferGeometry(), mp = new Float32Array(MOTES * 3), mseed = new Float32Array(MOTES);
  for (let i = 0; i < MOTES; i++) { mp[i * 3] = R(-14, 14); mp[i * 3 + 1] = R(-14, 14); mp[i * 3 + 2] = R(-14, 14); mseed[i] = rng(); }
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3)); keep(mg);
  const motes = new THREE.Points(mg, keep(new THREE.PointsMaterial({ color: '#b9d4a8', size: 0.07, map: keep(glowTexture(THREE)), transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending })));
  motes.frustumCulled = false; scene.add(motes);

  // ---------- atmosphere by depth: keyframes along the descent ----------
  // y, fog density, hemi, key light, lantern, rim strength, rim colour, column strength
  const ATMO = [
    [60, 0.010, 0.34, 7.0, 1.6, 0.30, '#a1c58e', 1.0],
    [0, 0.013, 0.30, 6.4, 2.4, 0.32, '#a1c58e', 0.9],
    [-70, 0.015, 0.24, 4.0, 3.6, 0.30, '#8fb27e', 0.55],
    [-150, 0.0080, 0.27, 1.8, 5.0, 0.30, '#7da772', 0.45],
    [-235, 0.020, 0.14, 0.4, 6.5, 0.30, '#93c47f', 0.08],
    [-330, 0.0068, 0.16, 0.12, 7.0, 0.22, '#9db78f', 0.06],
    [-414, 0.0060, 0.14, 0.06, 7.0, 0.18, '#c9c2a6', 0.04]
  ];
  const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
  function atmo(y) {
    let i = 0; while (i < ATMO.length - 2 && y < ATMO[i + 1][0]) i++;
    const a = ATMO[i], b = ATMO[i + 1], t = smooth((a[0] - y) / (a[0] - b[0]));
    tmpC.set(a[6]).lerp(tmpC2.set(b[6]), t);
    return { above: lerp(a[7], b[7], t), fog: lerp(a[1], b[1], t), hemi: lerp(a[2], b[2], t), key: lerp(a[3], b[3], t), lantern: lerp(a[4], b[4], t), rim: lerp(a[5], b[5], t), rimColor: tmpC };
  }

  // ---------- per-frame state ----------
  const S = { slabY: STOPS[0], slabVel: 0, lean: 0, land: 0, celebrate: 0, dark: 0, urgency: 0, pulse: 0, finale: 0, t: 0, swing: 0, swingV: 0 };
  slab.position.y = S.slabY;
  function update(dt, cam) {
    S.t += dt; shared.uTime.value = S.t;
    const y = S.slabY;
    slab.position.y = y;
    for (const c of cables) { const top = 59, bot = y + 0.1, h = top - bot; c.scale.set(0.06, h, 0.06); c.position.set(c.userData.off[0], bot + h / 2, c.userData.off[1]); }
    // the traveller: breathing, lean in descent, a dip on landing, lantern swing
    const breath = Math.sin(S.t * 1.7) * 0.012;
    body.scale.set(1, 1 + breath, 1);
    body.rotation.z = S.lean * 0.06 + Math.sin(S.t * 0.7) * 0.012;
    body.position.y = -S.land * 0.08;
    const raise = smooth(S.celebrate);
    staffPivot.rotation.z = -0.08 + raise * 0.35; staffPivot.position.y = 0.9 + raise * 0.32;
    arm.rotation.z = 0.6 + raise * 0.5;
    // the lantern is a pendulum driven by the slab's acceleration
    const acc = S.slabAcc || 0;
    S.swingV += (-S.swing * 9 - S.swingV * 1.6 + acc * 0.03) * dt; S.swing += S.swingV * dt;
    lanternPivot.rotation.z = S.swing + Math.sin(S.t * 1.1) * 0.03;
    lanternPivot.rotation.x = Math.sin(S.t * 0.83) * 0.03;
    // atmosphere
    const A = atmo(y), dark = S.dark, keepLight = 1 - dark * 0.88;
    scene.fog.density = A.fog * (1 + dark * 1.6) * (1 - S.finale * 0.15);
    hemi.intensity = A.hemi * keepLight * (1 + S.finale * 0.4);
    fill.intensity = A.above * 0.5 * keepLight; fill.position.set(6, y + 100, 10); fill.target.position.set(0, y, 0);
    const pulse = S.urgency > 0 ? (0.5 + 0.5 * Math.sin(S.pulse)) * S.urgency : 0;
    key.intensity = A.key * keepLight * (1 - pulse * 0.25);
    key.target.position.set(0, y, 0);
    colMat.uniforms.uStr.value = 0.22 * keepLight * (1 - pulse * 0.3); colMat2.uniforms.uStr.value = 0.42 * keepLight * (1 - pulse * 0.3);
    shared.uRim.value.copy(A.rimColor); shared.uRimStr.value = A.rim * keepLight;
    lantern.getWorldPosition(lanternLight.position);
    const flicker = 1 + Math.sin(S.t * 13) * 0.02 + Math.sin(S.t * 7.3) * 0.03 + pulse * 0.25;
    lanternLight.intensity = A.lantern * flicker * (1 - dark * 0.8) * (1 + raise * 0.7);
    lanternGlow.material.opacity = 0.5 * (1 - dark * 0.8) * (1 + raise * 0.6);
    M.lantern.color.setRGB(0.85, 0.94, 0.78).multiplyScalar(1 - dark * 0.6);
    // local lights only where they matter
    const near = (yc, span) => clamp(1 - Math.abs(y - yc) / span, 0, 1);
    crackLights[0].intensity = 260 * near(-170, 90) * keepLight; crackLights[1].intensity = 220 * near(-175, 90) * keepLight;
    crackLights[2].intensity = 60 * near(-260, 70) * keepLight;
    M.glow.color.set(PAL.green).multiplyScalar(0.85 * keepLight);
    // the finale: the monolith wakes
    const f = S.finale;
    finalLight.intensity = (30 + f * 300) * (y < -300 ? 1 : 0) * keepLight;
    M.slit.opacity = 0.22 + f * 0.6;
    halo.material.opacity = f * 0.08;
    finaleBeamMat.uniforms.uStr.value = f * 0.3;
    // motes wrap around the camera and drift down slowly (up, during descent)
    const p = mg.attributes.position.array, cx = cam.position.x, cy = cam.position.y, cz = cam.position.z;
    const fallV = -0.25 + (S.slabVel || 0) * -0.05;
    for (let i = 0; i < MOTES; i++) {
      let px = p[i * 3], py = p[i * 3 + 1], pz = p[i * 3 + 2];
      py += (fallV * (0.5 + mseed[i])) * dt; px += Math.sin(S.t * 0.3 + mseed[i] * 30) * 0.08 * dt;
      // wrap into a 28 m box around the camera
      const wrap = (v, c) => { const d = v - c; return d > 14 ? v - 28 : d < -14 ? v + 28 : v; };
      p[i * 3] = wrap(px, cx); p[i * 3 + 1] = wrap(py, cy); p[i * 3 + 2] = wrap(pz, cz);
    }
    mg.attributes.position.needsUpdate = true;
    motes.material.opacity = 0.5 * (1 - dark * 0.7);
    for (const g of eyes) { const ph = (S.t * 0.35 + g.userData.phase) % 6.5; g.scale.y = ph < 0.18 ? Math.abs(ph - 0.09) / 0.09 : 1; g.visible = Math.abs(g.position.y - y) < 120; }
    eyeMat.opacity = (0.32 + S.urgency * 0.25) * (1 - S.finale) * (1 - dark * 0.3);
  }
  function dispose() { for (const d of disposables) try { d.dispose(); } catch (e) { } scene.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); }
  return { scene, S, update, dispose, slab, fig, lantern, MONO: { th: MONO_TH, r: MONO_R }, STOPS, FINAL_Y };
}

function glowTexture(THREE) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
