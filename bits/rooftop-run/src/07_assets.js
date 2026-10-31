// =====================================================================
// Materials, procedural textures and the static batcher.
//
// Palette: deep charcoal and blue-grey dusk; aged terracotta; dirty cream
// plaster; oxidised teal-grey and rust metal; warm light from old windows;
// toxic green and restrained violet only where the industry glows.
// Walkable surfaces are the warmest, lightest values in their area;
// voids fall to near-black. The black cat carries a cool rim light.
// =====================================================================

const PAL = {
  skyTop: '#0d121b', skyHorizon: '#3a4452', skyBand: '#6e6150', fog: '#2b333d',
  tile: '#a65a3c', plaster: ['#b6aa94', '#8f9aa0', '#a8957a', '#7f8e8c', '#b09a86'],
  metal: '#5b6a6c', rust: '#6d4a37', brick: '#7a4636', tin: '#7b7466',
  warm: '#ffb36b', green: '#7dffb0', violet: '#b48cff', street: '#0b0d10'
};

function createAssets(THREE, renderer, ctx) {
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1);
  const canvases = [];
  function paint(size, draw, opts) {
    // texture canvases come from the runtime (cleanup-owned) and are never shown
    const c = ctx.createCanvas2D({ layer: 'background', input: 'passthrough' });
    c.style.display = 'none'; c.width = size; c.height = (opts && opts.h) || size;
    const g = c.getContext('2d'); draw(g, c.width, c.height);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = opts && opts.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    if (!(opts && opts.clamp)) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    canvases.push(c);
    return t;
  }
  const rng = makeRng(7);
  function speckle(g, w, h, n, cols, rmin, rmax, a) {
    for (let i = 0; i < n; i++) {
      g.globalAlpha = a * (0.4 + rng() * 0.6); g.fillStyle = cols[i % cols.length];
      const r = rmin + rng() * (rmax - rmin), x = rng() * w, y = rng() * h;
      for (const [ox, oy] of [[0, 0], [w, 0], [0, h], [-w, 0], [0, -h]]) { g.beginPath(); g.arc(x + ox, y + oy, r, 0, TAU); g.fill(); }
    }
    g.globalAlpha = 1;
  }
  function streaks(g, w, h, n, col, len) {
    for (let i = 0; i < n; i++) { const x = rng() * w, ww = 1 + rng() * 5, hh = len * (0.3 + rng()); const gr = g.createLinearGradient(0, 0, 0, hh); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x, rng() * h * 0.3, ww, hh); }
  }

  // terracotta: 1 tile = 1 m. Overlapping courses of half-round tiles.
  const tiles = paint(256, (g, w, h) => {
    g.fillStyle = '#5a2c1e'; g.fillRect(0, 0, w, h);
    const rows = 8, cols = 4;
    for (let r = 0; r < rows; r++) {
      const y = r * h / rows, off = (r % 2) * (w / cols / 2);
      for (let c = -1; c <= cols; c++) {
        const x = c * w / cols + off, tw = w / cols - 2, th = h / rows + 6;
        const v = 0.78 + rng() * 0.32, moss = rng() < 0.04;
        const gr = g.createLinearGradient(x, 0, x + tw, 0);
        const base = moss ? [96, 104, 70] : [178 * v, 96 * v, 64 * v];
        gr.addColorStop(0, `rgb(${base[0] * 0.55 | 0},${base[1] * 0.55 | 0},${base[2] * 0.55 | 0})`);
        gr.addColorStop(0.45, `rgb(${base[0] | 0},${base[1] | 0},${base[2] | 0})`);
        gr.addColorStop(1, `rgb(${base[0] * 0.5 | 0},${base[1] * 0.5 | 0},${base[2] * 0.5 | 0})`);
        g.fillStyle = gr; g.beginPath(); g.roundRect ? g.roundRect(x + 1, y - 3, tw, th, 6) : g.rect(x + 1, y - 3, tw, th); g.fill();
        g.fillStyle = 'rgba(20,10,6,.45)'; g.fillRect(x + 1, y + th - 7, tw, 3);
      }
    }
    speckle(g, w, h, 500, ['#2b1a14', '#d9a37f', '#3c3a2a'], 0.5, 2, 0.25);
    streaks(g, w, h, 18, 'rgba(15,12,10,.35)', 120);
  });
  // plaster wall: 1 tile = 3 m. Shutters, dark panes, rain streaks, a slab band.
  const WIN = [[0.12, 0.3, 0.2, 0.42], [0.58, 0.3, 0.2, 0.42]];
  const plaster = paint(256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 1500, ['#d0c8bd', '#ffffff', '#a9a196', '#8d867d'], 0.5, 2.2, 0.3);
    speckle(g, w, h, 20, ['#9b8f80', '#7e8a8a'], 14, 40, 0.12);       // patched plaster
    streaks(g, w, h, 40, 'rgba(40,36,34,.3)', 150);
    g.fillStyle = 'rgba(60,54,50,.5)'; g.fillRect(0, 0, w, 8);
    for (const [x, y, ww, hh] of WIN) {
      g.fillStyle = 'rgba(70,64,58,.7)'; g.fillRect((x - 0.02) * w, (y - 0.03) * h, (ww + 0.04) * w, (hh + 0.06) * h);
      g.fillStyle = '#121418'; g.fillRect(x * w, y * h, ww * w, hh * h);
      g.fillStyle = 'rgba(160,170,175,.18)'; g.fillRect(x * w + ww * w / 2 - 1, y * h, 2, hh * h);
    }
  });
  // window light: drawn into the emissive map. Some panes lit warm, a few cold.
  const windows = paint(256, (g, w, h) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (const [x, y, ww, hh] of WIN) {
      const gr = g.createLinearGradient(0, y * h, 0, (y + hh) * h);
      gr.addColorStop(0, '#7a3e12'); gr.addColorStop(1, '#ffb15e');
      g.fillStyle = gr; g.fillRect(x * w + 2, y * h + 2, ww * w - 4, hh * h - 4);
      g.fillStyle = 'rgba(0,0,0,.65)'; g.fillRect(x * w + ww * w / 2 - 1, y * h, 2, hh * h);
    }
  });
  const metal = paint(256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['#c8cfcf', '#ffffff', '#8f9897'], 0.5, 2, 0.35);
    speckle(g, w, h, 60, ['#8a5a3c', '#6b3f28', '#b0764a'], 3, 14, 0.45);   // rust blooms
    streaks(g, w, h, 30, 'rgba(110,62,36,.4)', 90);
    g.fillStyle = 'rgba(30,30,30,.5)'; for (let i = 0; i < 4; i++) g.fillRect(0, i * h / 4, w, 2);
    g.fillStyle = 'rgba(25,25,25,.6)'; for (let x = 6; x < w; x += 16) for (let i = 0; i < 4; i++) g.fillRect(x, i * h / 4 + 5, 2, 2);
  });
  const grate = paint(128, (g, w, h) => {
    g.fillStyle = '#2a2724'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#8e7a68'; for (let i = 0; i < w; i += 8) { g.fillRect(i, 0, 3, h); }
    g.fillStyle = '#6d5a4a'; for (let j = 0; j < h; j += 32) g.fillRect(0, j, w, 4);
    speckle(g, w, h, 120, ['#a0643a', '#3a2a20'], 1, 4, 0.5);
  });
  const brick = paint(128, (g, w, h) => {
    g.fillStyle = '#3a2620'; g.fillRect(0, 0, w, h);
    for (let r = 0; r < 8; r++) for (let c = -1; c < 4; c++) {
      const v = 0.75 + rng() * 0.4; g.fillStyle = `rgb(${150 * v | 0},${78 * v | 0},${58 * v | 0})`;
      g.fillRect(c * 32 + (r % 2) * 16 + 1, r * 16 + 1, 30, 14);
    }
    streaks(g, w, h, 12, 'rgba(10,10,10,.5)', 70);
  });
  const tin = paint(128, (g, w, h) => {
    for (let x = 0; x < w; x++) { const v = 0.7 + 0.3 * Math.sin(x / w * TAU * 8); g.fillStyle = `rgb(${190 * v | 0},${182 * v | 0},${168 * v | 0})`; g.fillRect(x, 0, 1, h); }
    speckle(g, w, h, 140, ['#7a3e20', '#5b2e18', '#a5603a'], 2, 10, 0.5);
    streaks(g, w, h, 20, 'rgba(90,40,20,.5)', 80);
  });
  const concrete = paint(128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    speckle(g, w, h, 900, ['#9a948c', '#c9c2b8', '#ffffff', '#77726c'], 0.4, 1.6, 0.3);
    speckle(g, w, h, 14, ['#6d675f'], 8, 24, 0.12);
    g.fillStyle = 'rgba(50,46,42,.35)'; g.fillRect(0, h / 2 - 1, w, 2); g.fillRect(w / 2 - 1, 0, 2, h);
  });
  const fur = paint(64, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); speckle(g, w, h, 400, ['#cfd3dc', '#ffffff', '#9aa0aa'], 0.3, 1, 0.5); });
  const glow = paint(64, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.25, 'rgba(255,255,255,.55)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, { clamp: true });
  const puff = paint(64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,.9)'); r.addColorStop(0.6, 'rgba(255,255,255,.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  }, { clamp: true });
  const blob = paint(64, (g, w, h) => { const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.6, 'rgba(255,255,255,.5)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, h); }, { clamp: true });

  const lam = o => new THREE.MeshLambertMaterial(o);
  const add = (map, col) => new THREE.SpriteMaterial({ map, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  // the cat's fur: Lambert plus a fresnel rim so a black cat reads on dark roofs
  const rimU = { rimColor: { value: new THREE.Color('#9fb6dc') }, rimStrength: { value: 0.3 } };
  const rimmed = m => {
    m.onBeforeCompile = sh => {
      Object.assign(sh.uniforms, rimU);
      sh.fragmentShader = 'uniform vec3 rimColor; uniform float rimStrength;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
        'float rimK = pow(1.0 - clamp(dot(normalize(normal), normalize(vViewPosition)), 0.0, 1.0), 3.4);\noutgoingLight += rimColor * rimK * rimStrength;\n#include <opaque_fragment>');
    };
    m.customProgramCacheKey = () => 'rim';
    return m;
  };
  const M = {
    tile: lam({ map: tiles, vertexColors: true }),
    wall: lam({ map: plaster, vertexColors: true, emissiveMap: windows, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 1 }),
    metal: lam({ map: metal, vertexColors: true }),
    grate: lam({ map: grate, vertexColors: true }),
    brick: lam({ map: brick, vertexColors: true }),
    tin: lam({ map: tin, vertexColors: true }),
    concrete: lam({ map: concrete, vertexColors: true }),
    plain: lam({ vertexColors: true }),
    dark: lam({ color: '#15181d' }),
    cable: new THREE.MeshBasicMaterial({ color: '#0d0f12' }),
    street: new THREE.MeshBasicMaterial({ color: PAL.street }),
    shadow: new THREE.MeshBasicMaterial({ color: '#000000', transparent: true, opacity: 0.4, depthWrite: false, alphaMap: blob }),
    fur: rimmed(lam({ map: fur, vertexColors: true })),
    furPlain: rimmed(lam({ vertexColors: true })),
    eye: new THREE.MeshBasicMaterial({ color: '#c9f25e' }),
    nose: lam({ color: PAL.nose || '#2c2024' }),
    collar: lam({ color: '#5e2a2a' }),
    core: new THREE.MeshBasicMaterial({ color: PAL.green }),
    coreGlow: add(glow, PAL.green),
    glowWarm: add(glow, PAL.warm), glowGreen: add(glow, PAL.green), glowViolet: add(glow, PAL.violet), glowRed: add(glow, '#ff5a3c'),
    fragment: new THREE.MeshBasicMaterial({ color: '#a8ffd0' }),
    steam: new THREE.PointsMaterial({ map: puff, color: '#c9d2d8', size: 0.9, transparent: true, opacity: 0.55, depthWrite: false, sizeAttenuation: true }),
    smoke: new THREE.PointsMaterial({ map: puff, color: '#3a4049', size: 3.2, transparent: true, opacity: 0.35, depthWrite: false, sizeAttenuation: true })
  };
  const T = { tiles, plaster, windows, metal, grate, brick, tin, concrete, fur, glow, puff, blob };
  return { M, T, THREE, canvases };
}

// ---------------------------------------------------------------------
// Batcher: accumulates quads, triangles, boxes and arbitrary geometry
// into one geometry per material, with world-space UVs, so all static
// architecture costs one draw call per material.
// ---------------------------------------------------------------------
class Batch {
  constructor() { this.b = new Map(); }
  bucket(key) { let k = this.b.get(key); if (!k) this.b.set(key, k = { p: [], n: [], u: [], c: [], i: [] }); return k; }
  quad(key, a, b, c, d, n, uv, cols) {
    const k = this.bucket(key), base = k.p.length / 3;
    for (const v of [a, b, c, d]) k.p.push(v[0], v[1], v[2]);
    for (let i = 0; i < 4; i++) k.n.push(n[0], n[1], n[2]);
    for (const t of uv) k.u.push(t[0], t[1]);
    for (const col of cols) k.c.push(col[0], col[1], col[2]);
    k.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  tri(key, a, b, c, n, uv, cols) {
    const k = this.bucket(key), base = k.p.length / 3;
    for (const v of [a, b, c]) k.p.push(v[0], v[1], v[2]);
    for (let i = 0; i < 3; i++) k.n.push(n[0], n[1], n[2]);
    for (const t of uv) k.u.push(t[0], t[1]);
    for (const col of cols) k.c.push(col[0], col[1], col[2]);
    k.i.push(base, base + 1, base + 2);
  }
  // Box with per-face materials and colours.
  //   o.top / o.side: material keys; o.topCol / o.sideCol / o.sideColLow: [r,g,b]
  //   o.uvTop, o.uvSide: metres per texture tile; o.uvShift: offsets side UVs; o.faces: which faces
  box(x0, x1, y0, y1, z0, z1, o) {
    const f = o.faces || { top: true, bottom: false, px: true, nx: true, pz: true, nz: true };
    const tt = o.uvTop || 4, ts = o.uvSide || 3, sh = o.uvShift || 0;
    const tc = o.topCol || [1, 1, 1], sc = o.sideCol || [1, 1, 1], sl = o.sideColLow || sc;
    const lowAt = y => { const k = clamp((y1 - y) / (o.fadeDepth || 9), 0, 1); return [lerp(sc[0], sl[0], k), lerp(sc[1], sl[1], k), lerp(sc[2], sl[2], k)]; };
    const cH = lowAt(y1), cL = lowAt(y0);
    if (f.top) this.quad(o.top, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0], [[x0 / tt, z1 / tt], [x1 / tt, z1 / tt], [x1 / tt, z0 / tt], [x0 / tt, z0 / tt]], [tc, tc, tc, tc]);
    if (f.bottom) this.quad(o.side, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0], [[0, 0], [1, 0], [1, 1], [0, 1]], [cL, cL, cL, cL]);
    const side = (a, b, c, d, n, u0, u1) => this.quad(o.side, a, b, c, d, n, [[(u0 + sh) / ts, y0 / ts], [(u1 + sh) / ts, y0 / ts], [(u1 + sh) / ts, y1 / ts], [(u0 + sh) / ts, y1 / ts]], [cL, cL, cH, cH]);
    if (f.pz) side([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1], x0, x1);
    if (f.nz) side([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [0, 0, -1], -x1, -x0);
    if (f.px) side([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0], -z1, -z0);
    if (f.nx) side([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0], z0, z1);
  }
  geo(key, g, m, col, THREE) {
    const k = this.bucket(key), base = k.p.length / 3;
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(m), v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); k.p.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); k.n.push(v.x, v.y, v.z);
      k.u.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      k.c.push(col[0], col[1], col[2]);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) k.i.push(base + g.index.getX(i));
    else for (let i = 0; i < p.count; i++) k.i.push(base + i);
  }
  build(THREE, mats, opts) {
    const group = new THREE.Group();
    for (const [key, k] of this.b) {
      if (!k.i.length || !mats[key]) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(k.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(k.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(k.u, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(k.c, 3));
      g.setIndex(k.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(k.i, 1) : new THREE.Uint16BufferAttribute(k.i, 1));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[key]);
      m.castShadow = !!(opts && opts.cast); m.receiveShadow = !!(opts && opts.receive);
      m.matrixAutoUpdate = false; m.updateMatrix();
      group.add(m);
    }
    return group;
  }
}

const hex3 = h => { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };
const mul3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

function disposeTree(o) {
  o.traverse(n => {
    if (n.geometry && !(n.geometry.userData && n.geometry.userData.shared)) n.geometry.dispose();
    const ms = Array.isArray(n.material) ? n.material : n.material ? [n.material] : [];
    for (const m of ms) if (m.userData && m.userData.own) m.dispose();
  });
  if (o.parent) o.parent.remove(o);
}
