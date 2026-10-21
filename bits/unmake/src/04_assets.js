// =====================================================================
// Visual language: procedural textures, materials, sky, atmosphere.
//
// Three architectural layers, each with its own materials:
//   settlement   — chalk mineral stone, sun-worn ceramic, mineral-stained plaster,
//                  red-brown pigment marks, waterline scars
//   preservation — rusted iron frames, verdigris copper, rivets, bolted plates,
//                  and the glaze: the cool, regular tile the preservers clad
//                  their additions in. Anything glazed can be unmade.
//   returning    — roots, moss, blue-green water, desaturated green growth
// =====================================================================

const PALETTE = {
  chalk: '#d6cfbf', chalkWarm: '#e2d6bf', plaster: '#c9b79a', ceramic: '#e7ddca', pigment: '#7c3526',
  rust: '#6d3a27', rustLight: '#8f5236', verdigris: '#4f7f72', iron: '#3c3a3b',
  cavity: '#2a2830', root: '#7a6a5d', rootLight: '#a49383', moss: '#5e7556', leaf: '#76815c', water: '#4e7f7c',
  skyTop: '#857f8a', skyHorizon: '#e5c79c', basin: '#3b3136', sun: '#ffc88c',
  sever: '#ffb24a', dismantle: '#e8653c', redirect: '#63c7ad',
  glaze: '#d9dbd0', glazeGrout: '#9aa49c', unmake: '#fff1d6', consequence: '#e3b06a', ink: '#2a2326',
  mantle: '#3e4a5f', mantleDark: '#2b3343', hat: '#d9cdb1', sash: '#b4813a', mask: '#efe6d6'
};

function createAssets(THREE, renderer, scratch) {
  const A = { THREE, renderer };
  const trng = makeRng(77);

  // ---------- texture painting on the SDK scratch surface ----------
  function paint(w, h, draw, srgb, repeat) {
    scratch.width = w; scratch.height = h;
    const g = scratch.getContext('2d', { willReadFrequently: true });
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
    g.clearRect(0, 0, w, h);
    draw(g, w, h);
    const src = g.getImageData(0, 0, w, h).data;
    const data = new Uint8Array(w * h * 4);
    const row = w * 4;
    for (let y = 0; y < h; y++) data.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
    const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
    t.wrapS = t.wrapT = repeat === false ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.colorSpace = srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    t.needsUpdate = true;
    return t;
  }
  function grain(g, w, h, n, cols, smin, smax, a) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + trng() * 0.6);
      g.fillStyle = cols[Math.floor(trng() * cols.length)];
      const s = smin + trng() * (smax - smin);
      g.fillRect(trng() * w, trng() * h, s, s * (0.4 + trng()));
    }
    g.globalAlpha = 1;
  }
  function noiseFill(g, w, h, base, amp) {
    g.fillStyle = base; g.fillRect(0, 0, w, h);
    const img = g.getImageData(0, 0, w, h);
    for (let i = 0; i < img.data.length; i += 4) { const n = (trng() - 0.5) * amp; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n * 0.9; }
    g.putImageData(img, 0, 0);
  }
  // waterline scars: pale mineral bands with a darker stain beneath
  function waterlines(g, w, h, rows) {
    for (const r of rows) {
      const y = r * h;
      const grd = g.createLinearGradient(0, y - 6, 0, y + 26);
      grd.addColorStop(0, 'rgba(244,238,224,0.0)'); grd.addColorStop(0.18, 'rgba(244,238,224,0.55)'); grd.addColorStop(0.3, 'rgba(110,98,84,0.32)'); grd.addColorStop(1, 'rgba(110,98,84,0)');
      g.fillStyle = grd; g.fillRect(0, y - 6, w, 32);
      g.strokeStyle = 'rgba(250,246,236,0.5)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.07 + r * 9) * 1.5); g.stroke();
    }
  }
  const T = {};
  // chalk flagstones: irregular, sun-worn, mortar with fine moss
  T.flag = paint(512, 512, (g, w, h) => {
    noiseFill(g, w, h, '#d5cdbd', 16);
    const rows = [0, 140, 260, 390, 512];
    for (let r = 0; r < rows.length - 1; r++) {
      let x = -trng() * 80;
      while (x < w) {
        const ww = 110 + trng() * 120;
        const v = 0.93 + trng() * 0.1;
        g.fillStyle = `rgba(${Math.round(218 * v)},${Math.round(208 * v)},${Math.round(190 * v)},0.55)`;
        g.fillRect(x + 3, rows[r] + 3, ww - 6, rows[r + 1] - rows[r] - 6);
        g.fillStyle = 'rgba(92,80,66,0.55)'; g.fillRect(x, rows[r], 3, rows[r + 1] - rows[r]);
        x += ww;
      }
      g.fillStyle = 'rgba(92,80,66,0.6)'; g.fillRect(0, rows[r], w, 3);
      g.fillStyle = 'rgba(255,250,240,0.35)'; g.fillRect(0, rows[r] + 3, w, 1);
    }
    grain(g, w, h, 2400, ['#bfb4a0', '#e8e1d2', '#a89c86'], 1, 4, 0.35);
    for (let i = 0; i < 220; i++) { g.fillStyle = trng() < 0.6 ? 'rgba(88,108,78,0.45)' : 'rgba(70,96,84,0.4)'; g.fillRect(trng() * w, rows[Math.floor(trng() * 4)] - 2 + trng() * 4, 2 + trng() * 5, 2 + trng() * 3); }
    for (let i = 0; i < 18; i++) { g.fillStyle = 'rgba(160,120,70,0.07)'; g.beginPath(); g.arc(trng() * w, trng() * h, 20 + trng() * 60, 0, TAU); g.fill(); }
  });
  // settlement walls: plaster over stone, mineral stains, waterline scars, pigment marks
  T.plaster = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#cdbca0', 14);
    grain(g, w, h, 1600, ['#b8a486', '#ddcdb3', '#a8916f'], 1, 5, 0.3);
    for (let i = 0; i < 26; i++) { g.globalAlpha = 0.07; g.fillStyle = '#5f4936'; g.fillRect(trng() * w, trng() * h * 0.4, 2 + trng() * 3, 40 + trng() * 120); }
    g.globalAlpha = 1;
    waterlines(g, w, h, [0.42, 0.71]);
    // a band of red-brown pigment: old markings of the first settlement
    g.fillStyle = 'rgba(124,53,38,0.55)'; g.fillRect(0, h * 0.14, w, 5);
    for (let x = 8; x < w; x += 32) { g.fillRect(x, h * 0.14 - 9, 4, 9); g.beginPath(); g.arc(x + 14, h * 0.14 + 12, 4, 0, TAU); g.fill(); }
  });
  // carved mineral stone: strata and course joints
  T.stone = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#bdb3a2', 14);
    for (let y = 0; y < h; y += 2) { const a = 0.03 + 0.05 * Math.abs(Math.sin(y * 0.09) * Math.sin(y * 0.031)); g.fillStyle = `rgba(80,70,58,${a.toFixed(3)})`; g.fillRect(0, y, w, 2); }
    for (let y = 0; y < h; y += 64) { g.fillStyle = 'rgba(70,60,48,0.4)'; g.fillRect(0, y, w, 2); for (let x = (y / 64) % 2 ? 40 : 0; x < w; x += 104) g.fillRect(x, y, 2, 64); }
    waterlines(g, w, h, [0.6]);
  });
  // preservation iron: rust over plate, rivet lines, verdigris on the copper fittings
  T.rust = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#6b3c2a', 20);
    grain(g, w, h, 1400, ['#7f4a30', '#55301f', '#9a5e3c', '#4a3a34'], 1, 5, 0.45);
    for (let i = 0; i < 26; i++) { g.globalAlpha = 0.18; g.fillStyle = '#3c2a22'; g.fillRect(trng() * w, trng() * h, 2, 30 + trng() * 60); }
    g.globalAlpha = 1;
    for (let i = 0; i < 6; i++) { const x = trng() * w, y = trng() * h; const grd = g.createRadialGradient(x, y, 0, x, y, 30 + trng() * 30); grd.addColorStop(0, 'rgba(80,128,112,0.45)'); grd.addColorStop(1, 'rgba(80,128,112,0)'); g.fillStyle = grd; g.fillRect(x - 60, y - 60, 120, 120); }
    g.fillStyle = 'rgba(30,22,20,0.6)'; g.fillRect(0, 62, w, 3); g.fillRect(0, 190, w, 3);
    g.fillStyle = '#9b6a4c'; for (const yy of [52, 74, 180, 202]) for (let x = 10; x < w; x += 22) { g.beginPath(); g.arc(x, yy, 2.6, 0, TAU); g.fill(); }
  });
  T.verdigris = paint(128, 128, (g, w, h) => { noiseFill(g, w, h, '#4d7c6f', 22); grain(g, w, h, 600, ['#6fa190', '#3a5f55', '#8a6a46'], 1, 4, 0.4); });
  T.timber = paint(256, 128, (g, w, h) => {
    noiseFill(g, w, h, '#7d6248', 12);
    for (let i = 0; i < 90; i++) { g.strokeStyle = trng() < 0.5 ? 'rgba(50,36,26,0.35)' : 'rgba(170,140,108,0.2)'; g.lineWidth = 1 + trng(); g.beginPath(); const y = trng() * h; g.moveTo(0, y); for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 2); g.stroke(); }
    for (let k = 1; k < 4; k++) { g.fillStyle = 'rgba(36,26,18,0.6)'; g.fillRect(0, k * h / 4 - 1, w, 2); }
    for (const x of [14, w - 26]) { g.fillStyle = '#5a2f20'; g.fillRect(x, 0, 12, h); g.fillStyle = '#a8724e'; for (let y = 8; y < h; y += 20) g.fillRect(x + 4, y, 4, 4); }
  });
  // root bark: long fibres, paler ridges, mineral dust
  T.bark = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#76675a', 18);
    for (let i = 0; i < 160; i++) { g.strokeStyle = trng() < 0.5 ? 'rgba(48,38,32,0.4)' : 'rgba(176,160,140,0.32)'; g.lineWidth = 1 + trng() * 2.5; g.beginPath(); let x = trng() * w; g.moveTo(x, 0); for (let y = 0; y <= h; y += 16) { x += (trng() - 0.5) * 6; g.lineTo(x, y); } g.stroke(); }
    for (let i = 0; i < 30; i++) { g.fillStyle = 'rgba(92,118,86,0.3)'; g.fillRect(trng() * w, trng() * h, 6 + trng() * 10, 3 + trng() * 6); }
  });
  T.ceramic = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#e3d8c4', 10);
    for (let y = 0; y < h; y += 32) for (let x = (y / 32) % 2 ? 16 : 0; x < w; x += 32) { const v = 0.94 + trng() * 0.08; g.fillStyle = `rgba(${Math.round(228 * v)},${Math.round(214 * v)},${Math.round(192 * v)},0.8)`; g.fillRect(x + 1, y + 1, 30, 30); }
    g.fillStyle = 'rgba(120,96,74,0.4)'; for (let y = 0; y < h; y += 32) g.fillRect(0, y, w, 1);
    for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(124,53,38,0.45)'; const x = Math.floor(trng() * 8) * 32, y = Math.floor(trng() * 8) * 32; g.fillRect(x + 12, y + 6, 8, 20); }
  });
  // the preservers' glaze: machine-regular square tiles, cool and even, a seal on every fourth
  T.glaze = paint(256, 256, (g, w, h) => {
    noiseFill(g, w, h, '#d8dace', 6);
    const n = 8, c = w / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = 0.97 + trng() * 0.05; g.fillStyle = `rgba(${Math.round(222 * v)},${Math.round(225 * v)},${Math.round(214 * v)},0.9)`; g.fillRect(x * c + 2, y * c + 2, c - 4, c - 4); }
    g.fillStyle = 'rgba(122,136,128,0.55)'; for (let i = 0; i <= n; i++) { g.fillRect(0, i * c - 1, w, 2); g.fillRect(i * c - 1, 0, 2, h); }
    g.strokeStyle = 'rgba(79,127,114,0.5)'; g.lineWidth = 1.5;
    for (let y = 0; y < n; y += 4) for (let x = 2; x < n; x += 4) { g.beginPath(); g.arc(x * c + c / 2, y * c + c / 2, c * 0.22, 0, TAU); g.stroke(); }
    for (let i = 0; i < 10; i++) { g.fillStyle = 'rgba(90,110,100,0.08)'; g.fillRect(trng() * w, 0, 3, h); }
  });
  T.cracks = paint(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineCap = 'round';
    const crack = (x, y, a, len, wd, depth) => {
      g.lineWidth = wd; g.beginPath(); g.moveTo(x, y);
      for (let i = 0; i < 6; i++) { a += (trng() - 0.5) * 0.9; x += Math.cos(a) * len / 6; y += Math.sin(a) * len / 6; g.lineTo(x, y); if (depth > 0 && trng() < 0.3) crack(x, y, a + (trng() - 0.5) * 2, len * 0.5, wd * 0.6, depth - 1); }
      g.stroke();
    };
    for (let k = 0; k < 5; k++) crack(w * 0.5 + (trng() - 0.5) * 60, h * 0.5 + (trng() - 0.5) * 60, trng() * TAU, w * 0.55, 3, 2);
  }, false, false);
  T.glow = paint(64, 64, (g, w, h) => { const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(0, 0, w, h); }, true, false);
  T.water = paint(128, 128, (g, w, h) => { noiseFill(g, w, h, '#4c7c79', 10); for (let i = 0; i < 70; i++) { g.strokeStyle = `rgba(232,236,214,${0.1 + trng() * 0.25})`; g.lineWidth = 1.4; g.beginPath(); const x = trng() * w, y = trng() * h; g.moveTo(x, y); g.quadraticCurveTo(x + 8, y - 3, x + 16, y); g.stroke(); } });
  T.mist = paint(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    for (let i = 0; i < 60; i++) { const x = trng() * w, y = trng() * h, r = 18 + trng() * 60; for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { const grd = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r); grd.addColorStop(0, `rgba(255,255,255,${0.08 + trng() * 0.1})`); grd.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = grd; g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2); } }
  });
  A.T = T;

  // ---------- occlusion dither + basin depth fog ----------
  // Anything between the camera and the traveller dissolves into a stipple, so
  // the architecture can stay monumental without ever hiding the player.
  const U = {
    uPlayer: { value: new THREE.Vector3() }, uCam: { value: new THREE.Vector3() },
    uBasin: { value: new THREE.Color(PALETTE.basin) }, uOccl: { value: 1 }, uTime: { value: 0 }
  };
  A.U = U;
  function patch(mat, key, extra) {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uPlayer = U.uPlayer; sh.uniforms.uCam = U.uCam; sh.uniforms.uBasin = U.uBasin; sh.uniforms.uOccl = U.uOccl;
      if (extra) extra(sh);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vUW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n vec4 uw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\n uw = instanceMatrix * uw;\n#endif\n vUW = (modelMatrix * uw).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vUW; uniform vec3 uPlayer; uniform vec3 uCam; uniform vec3 uBasin; uniform float uOccl;\n' +
          'float ditherB(vec2 p){ vec2 q = mod(floor(p), 4.0); float a = q.x + q.y * 4.0;' +
          ' return fract(sin(a * 12.9898 + 78.233) * 43758.5453) * 0.0 + mod(a * 7.0, 16.0) / 16.0 + 0.03; }')
        .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' +
          ' if (uOccl > 0.5) { vec3 ab = uPlayer - uCam; float L2 = max(dot(ab, ab), 0.01);' +
          '   float t = clamp(dot(vUW - uCam, ab) / L2, 0.0, 1.0);' +
          '   float d = length(vUW - (uCam + ab * t));' +
          '   float r = mix(2.6, 1.0, t);' +
          '   float f = (1.0 - smoothstep(r * 0.5, r, d)) * smoothstep(0.05, 0.15, t) * (1.0 - smoothstep(0.86, 0.94, t));' +
          '   if (f > 0.0 && ditherB(gl_FragCoord.xy) < f) discard; }')
        .replace('#include <fog_fragment>', '#ifdef USE_FOG\n float deep = smoothstep(-4.0, -42.0, vUW.y - uPlayer.y);\n' +
          ' gl_FragColor.rgb = mix(gl_FragColor.rgb, uBasin, deep * 0.85);\n' +
          ' float ff = smoothstep(fogNear, fogFar, vFogDepth);\n' +
          ' gl_FragColor.rgb = mix(gl_FragColor.rgb, mix(fogColor, uBasin, deep * 0.7), ff);\n#endif');
    };
    mat.customProgramCacheKey = () => 'unmake-' + key;
    return mat;
  }
  let mk = 0;
  const std = (o) => patch(new THREE.MeshStandardMaterial(Object.assign({ roughness: 0.92, metalness: 0 }, o)), 's' + (mk++ % 3));
  const M = {};
  M.flag = std({ map: T.flag });
  M.stone = std({ map: T.stone });
  M.stoneDark = std({ map: T.stone, color: '#8f857c' });
  M.plaster = std({ map: T.plaster });
  M.ceramic = std({ map: T.ceramic, roughness: 0.7 });
  M.rust = std({ map: T.rust, roughness: 0.75, metalness: 0.35 });
  M.rustDark = std({ map: T.rust, color: '#8a8080', roughness: 0.8, metalness: 0.3 });
  M.verdigris = std({ map: T.verdigris, roughness: 0.55, metalness: 0.45 });
  M.iron = std({ color: '#3d3b3c', roughness: 0.55, metalness: 0.6 });
  M.brass = std({ color: '#b48a46', roughness: 0.35, metalness: 0.75 });
  M.timber = std({ map: T.timber });
  M.bark = std({ map: T.bark, roughness: 1 });
  M.pigment = std({ color: PALETTE.pigment, roughness: 0.85 });
  M.cavity = std({ color: PALETTE.cavity, roughness: 1 });
  M.moss = std({ color: PALETTE.moss, roughness: 1, flatShading: true });
  M.leaf = std({ color: PALETTE.leaf, roughness: 0.95, flatShading: true });
  M.water = patch(new THREE.MeshStandardMaterial({ map: T.water, color: '#7fb2aa', roughness: 0.12, metalness: 0.05, transparent: true, opacity: 0.86 }), 'w');
  M.rope = std({ color: '#2f2c2b', roughness: 0.6, metalness: 0.5 });
  M.cloth = new THREE.MeshStandardMaterial({ color: '#c7b69a', roughness: 0.95, side: THREE.DoubleSide });
  M.vcStone = std({ vertexColors: true, map: T.stone });
  M.vcPlaster = std({ vertexColors: true, map: T.plaster });
  M.vcRust = std({ vertexColors: true, map: T.rust, color: '#b3a7a2', metalness: 0.3, roughness: 0.8 });
  M.vcBark = std({ vertexColors: true, map: T.bark });
  M.vcFlat = std({ vertexColors: true, flatShading: true });
  M.mantle = new THREE.MeshStandardMaterial({ color: PALETTE.mantle, roughness: 0.85 });
  M.mantleDark = new THREE.MeshStandardMaterial({ color: PALETTE.mantleDark, roughness: 0.9 });
  M.hat = new THREE.MeshStandardMaterial({ color: PALETTE.hat, roughness: 0.75 });
  M.sash = new THREE.MeshStandardMaterial({ color: PALETTE.sash, roughness: 0.8 });
  M.mask = new THREE.MeshStandardMaterial({ color: PALETTE.mask, roughness: 0.55 });
  M.legs = new THREE.MeshStandardMaterial({ color: '#2f2b2c', roughness: 0.85 });
  M.key = new THREE.MeshStandardMaterial({ color: '#f3d7a2', emissive: new THREE.Color('#ff9e3a'), emissiveIntensity: 0.6, roughness: 0.25 });
  M.relic = new THREE.MeshStandardMaterial({ color: '#f1e3c2', emissive: new THREE.Color('#ffb25a'), emissiveIntensity: 0.9, roughness: 0.3 });
  M.salvage = new THREE.MeshStandardMaterial({ color: '#b98a4a', metalness: 0.75, roughness: 0.35, emissive: new THREE.Color('#4a2c10'), emissiveIntensity: 0.4 });
  M.hidden = new THREE.MeshBasicMaterial({ visible: false });
  M.crackOverlay = new THREE.MeshBasicMaterial({ map: T.cracks, color: '#ffb070', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -2 });
  A.M = M;
  A.patch = patch;

  // ---------- the glaze, and the language of unmaking ----------
  // Every glazed body gets its own material so it can carry its own frame:
  //   copper edges   — oxidised trim along every edge: "this was added"
  //   uFocus         — targeted: a fine demolition hatch over its faces and a
  //                    chalk line on its edges — the exact region that will go
  //   uWipe          — unmade: the body is erased outward from where it was
  //                    touched, a clean front with a thin chalk rim. No debris.
  const glazeFrag = `
    uniform mat4 uInv; uniform vec3 uHalf; uniform vec3 uOrigin; uniform float uRad; uniform float uWipe; uniform float uFocus; uniform float uTime; uniform float uSealed;
    vec3 gLp; float gEdge; float gWipeD;
    void glazeFrame(){
      gLp = (uInv * vec4(vUW, 1.0)).xyz;
      vec3 e = max(uHalf - abs(gLp), 0.0);
      float m1 = min(e.x, min(e.y, e.z)); float m3 = max(e.x, max(e.y, e.z)); float m2 = e.x + e.y + e.z - m1 - m3;
      gEdge = m2;
      gWipeD = length(gLp - uOrigin) / max(uRad, 0.01);
    }`;
  const glazeExtra = (u) => (sh) => {
    Object.assign(sh.uniforms, u);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n glazeFrame();\n if (uWipe > 0.0 && gWipeD < uWipe) discard;')
      .replace('#include <map_fragment>', '#include <map_fragment>\n float trim = 1.0 - smoothstep(0.05, 0.09, gEdge);\n diffuseColor.rgb = mix(diffuseColor.rgb, mix(vec3(0.20, 0.36, 0.31), vec3(0.30, 0.29, 0.29), uSealed), trim * 0.9);\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.33))) * 0.86, uSealed * 0.6);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' +
        ' float hatch = step(0.82, fract((gLp.x + gLp.y - gLp.z) * 3.2 - uTime * 0.6));\n' +
        ' float line = 1.0 - smoothstep(0.0, 0.035, gEdge);\n' +
        ' float rim = uWipe > 0.0 ? 1.0 - smoothstep(0.0, 0.12, gWipeD - uWipe) : 0.0;\n' +
        ' totalEmissiveRadiance += vec3(1.0, 0.93, 0.80) * (uFocus * (hatch * 0.55 + line * 1.4 + 0.06) + rim * 2.2);');
    sh.fragmentShader = sh.fragmentShader.replace('#include <clipping_planes_pars_fragment>', '#include <clipping_planes_pars_fragment>' + glazeFrag);
  };
  A.glaze = function (b) {
    const u = {
      uInv: { value: new THREE.Matrix4() }, uHalf: { value: new THREE.Vector3(b.size[0], b.size[1], b.size[2]) },
      uOrigin: { value: new THREE.Vector3() }, uRad: { value: Math.hypot(b.size[0], b.size[1], b.size[2]) * 2 },
      uWipe: { value: 0 }, uFocus: { value: 0 }, uSealed: { value: 0 }, uTime: U.uTime
    };
    const m = patch(new THREE.MeshStandardMaterial({ map: T.glaze, roughness: 0.42, metalness: 0.02, color: '#f2f2ea' }), 'glaze', glazeExtra(u));
    m.userData.own = true; m.userData.u = u;
    return m;
  };

  // ---------- geometry helpers ----------
  // box with UVs in world units so textures keep their scale on every face
  A.box = function (w, h, d, ts) {
    const g = new THREE.BoxGeometry(w, h, d);
    const uv = g.attributes.uv, s = ts || 2.4;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) { const i = f * 4 + v; uv.setXY(i, uv.getX(i) * dims[f][0] / s, uv.getY(i) * dims[f][1] / s); }
    return g;
  };
  A.merge = function (parts) {
    let total = 0;
    const list = parts.map(p => { const g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone(); if (p.m) g.applyMatrix4(p.m); total += g.attributes.position.count; return { g, c: p.c }; });
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2), col = new Float32Array(total * 3);
    let o = 0; const tc = new THREE.Color();
    for (const { g, c } of list) {
      const n = g.attributes.position.count;
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      tc.set(c || '#ffffff');
      for (let i = 0; i < n; i++) { col[(o + i) * 3] = tc.r; col[(o + i) * 3 + 1] = tc.g; col[(o + i) * 3 + 2] = tc.b; }
      o += n; g.dispose();
    }
    const m = new THREE.BufferGeometry();
    m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    m.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    m.setAttribute('color', new THREE.BufferAttribute(col, 3));
    m.computeBoundingSphere();
    return m;
  };
  const _q = new THREE.Quaternion(), _e = new THREE.Euler(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
  A.mat = function (x, y, z, rx, ry, rz, sx, sy, sz) {
    _e.set(rx || 0, ry || 0, rz || 0); _q.setFromEuler(_e); _p.set(x, y, z);
    _s.set(sx === undefined ? 1 : sx, sy === undefined ? (sx === undefined ? 1 : sx) : sy, sz === undefined ? (sx === undefined ? 1 : sx) : sz);
    return new THREE.Matrix4().compose(_p, _q, _s);
  };
  A.G = {
    box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 12), cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
    sphere: new THREE.SphereGeometry(1, 20, 14), sphereLo: new THREE.SphereGeometry(1, 10, 7), dome: new THREE.SphereGeometry(1, 18, 9, 0, TAU, 0, Math.PI / 2),
    ico: new THREE.IcosahedronGeometry(1, 0), ico1: new THREE.IcosahedronGeometry(1, 1), torus: new THREE.TorusGeometry(1, 0.16, 8, 20), cone: new THREE.ConeGeometry(1, 1, 10), plane: new THREE.PlaneGeometry(1, 1)
  };
  for (const g of Object.values(A.G)) g.userData.shared = true;
  // a root: a tapering tube along a curve, with world-scale bark UVs
  A.rootGeo = function (points, r0, r1, seg) {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(p[0], p[1], p[2])));
    const n = seg || 40, rad = 9;
    const g = new THREE.TubeGeometry(curve, n, 1, rad, false);
    const pos = g.attributes.position, nor = g.attributes.normal, uv = g.attributes.uv;
    const len = curve.getLength();
    const pts = curve.getSpacedPoints(n);
    for (let i = 0; i <= n; i++) {
      const t = i / n, r = lerp(r0, r1, t) * (1 + 0.08 * Math.sin(t * 23) + 0.05 * Math.sin(t * 61));
      for (let j = 0; j <= rad; j++) {
        const k = i * (rad + 1) + j;
        const c = pts[i];
        const nx = nor.getX(k), ny = nor.getY(k), nz = nor.getZ(k);
        const lump = 1 + 0.12 * Math.sin(j * 2.1 + i * 0.7);
        pos.setXYZ(k, c.x + nx * r * lump, c.y + ny * r * lump, c.z + nz * r * lump);
        uv.setXY(k, j / rad * (r * TAU) / 2.4, t * len / 2.4);
      }
    }
    g.computeVertexNormals();
    return g;
  };

  // ---------- sky ----------
  const skyU = { cTop: { value: new THREE.Color(PALETTE.skyTop) }, cHor: { value: new THREE.Color(PALETTE.skyHorizon) }, cBot: { value: new THREE.Color(PALETTE.basin) }, sunDir: { value: new THREE.Vector3(-0.55, 0.32, -0.77).normalize() }, sunCol: { value: new THREE.Color('#ffd7a0') } };
  A.skyU = skyU;
  A.skyMat = new THREE.ShaderMaterial({
    uniforms: skyU,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }',
    fragmentShader: 'uniform vec3 cTop; uniform vec3 cHor; uniform vec3 cBot; uniform vec3 sunDir; uniform vec3 sunCol; varying vec3 vD;' +
      'void main(){ float y = vD.y; vec3 c = y > 0.0 ? mix(cHor, cTop, pow(smoothstep(0.0, 0.8, y), 0.7)) : mix(cHor, cBot, smoothstep(0.0, 0.32, -y));' +
      ' float sd = max(dot(normalize(vD), sunDir), 0.0); c += sunCol * (pow(sd, 400.0) * 1.2 + pow(sd, 18.0) * 0.22 + pow(sd, 3.0) * 0.07);' +
      ' float band = smoothstep(0.02, 0.0, abs(y - 0.06)) * 0.05; c += vec3(band * 0.9, band * 0.7, band * 0.4);' +
      ' gl_FragColor = vec4(c, 1.0); }',
    side: THREE.BackSide, depthWrite: false, fog: false
  });
  return A;
}
