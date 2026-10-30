// Plethora Bit · docs and draft upload: https://agent.plethora.studio/v1/agent/start.md
// DON'T LOOK BACK — an endless 3D survival game for Plethora.
// Built from src/ by build.js; edit the sources, not this file.
(function () {
'use strict';
// ---- 00_util.js ----
// Shared helpers: maths, seeded randomness, value noise and the winding trail.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
const rrange = (r, a, b) => a + (b - a) * r();
const rpick = (r, arr) => arr[Math.floor(r() * arr.length) % arr.length];

function hash2(x, y) { let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi), b = hash2(xi + 1, yi), c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y) { return vnoise(x, y) * 0.55 + vnoise(x * 2.1 + 7, y * 2.1 + 3) * 0.3 + vnoise(x * 4.3 + 1, y * 4.3 + 9) * 0.15; }

// The trail. Distance along it is s (metres travelled); the world runs toward -z.
const TRAIL = {
  x(s) { return 3.1 * Math.sin(s * 0.017) + 1.5 * Math.sin(s * 0.043 + 1.3) + 0.55 * Math.sin(s * 0.11 + 0.4); },
  dx(s) { return 3.1 * 0.017 * Math.cos(s * 0.017) + 1.5 * 0.043 * Math.cos(s * 0.043 + 1.3) + 0.55 * 0.11 * Math.cos(s * 0.11 + 0.4); },
  // heading of travel as a yaw (0 = facing -z)
  yaw(s) { return Math.atan2(-TRAIL.dx(s), 1); }
};
// world position of (s, lateral u)
function trailPoint(s, u, out) {
  const h = TRAIL.dx(s), n = Math.hypot(h, 1);
  // perpendicular to the direction of travel (dx/ds, -1) is (1, dx/ds)/n
  out.x = TRAIL.x(s) + u / n; out.z = -s + (u * h) / n;
  return out;
}

// Ground height: flat on and near the trail, rolling away from it, dipping into ravines.
const RAVINES = [];
function groundY(x, z) {
  const s = -z, off = Math.abs(x - TRAIL.x(s));
  let y = smooth((off - 4.5) / 9) * (fbm(x * 0.06, z * 0.06) * 3.2 - 0.6);
  y += (fbm(x * 0.4, z * 0.4) - 0.5) * 0.12;
  for (let i = 0; i < RAVINES.length; i++) {
    const r = RAVINES[i], d = Math.abs(s - r.s);
    if (d < r.half + 2) y -= smooth(1 - (d - r.half + 1.4) / 2.4) * 2.6;
  }
  return y;
}

// The forest's four stages, blended by distance.
const STAGES = [
  { at: 0, name: 'The Forgotten Woods', fog: '#1b2342', fogNear: 16, fogFar: 98, sky: '#2c3766', zen: '#070a1a', hemi: 0.85, moon: 1.8, trees: 20, twist: 0.12, dead: 0.1, hideGap: [30, 42], obsGap: [70, 95], halfW: 2.7, lantern: 0.55, struct: 0.25, apparition: 0.35 },
  { at: 380, name: 'The Hollow Forest', fog: '#161b35', fogNear: 11, fogFar: 78, sky: '#232a52', zen: '#05071a', hemi: 0.72, moon: 1.55, trees: 27, twist: 0.25, dead: 0.2, hideGap: [26, 40], obsGap: [52, 78], halfW: 2.5, lantern: 0.35, struct: 0.35, apparition: 0.6 },
  { at: 950, name: 'The Cursed Grounds', fog: '#1a1631', fogNear: 9, fogFar: 64, sky: '#2a2148', zen: '#070514', hemi: 0.62, moon: 1.35, trees: 30, twist: 0.45, dead: 0.35, hideGap: [32, 50], obsGap: [38, 60], halfW: 2.2, lantern: 0.25, struct: 0.6, apparition: 0.8 },
  { at: 1700, name: 'The Deep Dark', fog: '#0c0d1b', fogNear: 5, fogFar: 46, sky: '#141633', zen: '#020208', hemi: 0.5, moon: 1.1, trees: 33, twist: 0.6, dead: 0.5, hideGap: [38, 60], obsGap: [30, 48], halfW: 2.0, lantern: 0.15, struct: 0.45, apparition: 1.0 }
];
function stageIndex(s) { let i = 0; while (i < STAGES.length - 1 && s >= STAGES[i + 1].at) i++; return i; }
// numeric stage parameter blended over the 120 m before each boundary
function stageParam(s, key) {
  const i = stageIndex(s), a = STAGES[i], b = STAGES[i + 1];
  if (!b) return a[key];
  const t = smooth((s - (b.at - 120)) / 120);
  return lerp(a[key], b[key], t);
}
function stageMix(s) { const i = stageIndex(s), b = STAGES[i + 1]; return { i, t: b ? smooth((s - (b.at - 120)) / 120) : 0 }; }
// overall difficulty: 0 at the start, 1 by 2.2 km, creeping past it in the Deep Dark
const difficultyAt = s => s < 2200 ? s / 2200 : Math.min(1.3, 1 + (s - 2200) / 4000);

// ---- 01_assets.js ----
// Procedural textures, materials and low-poly geometry for the forest.
// makeCanvas comes from the runtime's own canvas factory: Bits never create raw canvas elements.
function createAssets(THREE, makeCanvas) {
  const tex = (w, h, draw, repeat) => {
    const c = makeCanvas(); c.width = w; c.height = h;
    const g = c.getContext('2d'); draw(g, w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    t.anisotropy = 4;
    return t;
  };
  const r = makeRng(77);
  const T = {};
  // bark: vertical fibres and knots, grey so vertex colour carries the hue
  T.bark = tex(128, 256, (g, w, h) => {
    g.fillStyle = '#b8b8bc'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) { const x = r() * w, l = 20 + r() * 120, y = r() * h; g.strokeStyle = `rgba(${r() < 0.5 ? '40,40,52' : '230,230,236'},${0.08 + r() * 0.22})`; g.lineWidth = 1 + r() * 3; g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + (r() - 0.5) * 8, y + l * 0.3, x + (r() - 0.5) * 8, y + l * 0.6, x + (r() - 0.5) * 6, y + l); g.stroke(); }
    for (let i = 0; i < 9; i++) { const x = r() * w, y = r() * h; g.fillStyle = 'rgba(30,30,40,.35)'; g.beginPath(); g.ellipse(x, y, 3 + r() * 5, 6 + r() * 9, 0, 0, 7); g.fill(); }
  }, [1, 2]);
  // forest floor: leaf litter
  T.ground = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#9a98a0'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) { const x = r() * w, y = r() * h, s = 1 + r() * 4.5; const v = r(); g.fillStyle = v < 0.45 ? `rgba(40,38,52,${0.2 + r() * 0.3})` : v < 0.8 ? `rgba(210,205,220,${0.08 + r() * 0.16})` : `rgba(120,110,140,${0.2 + r() * 0.2})`; g.beginPath(); g.ellipse(x, y, s, s * (0.4 + r() * 0.5), r() * 6.3, 0, 7); g.fill(); }
    for (let i = 0; i < 40; i++) { g.strokeStyle = 'rgba(30,28,40,.35)'; g.lineWidth = 1; g.beginPath(); const x = r() * w, y = r() * h; g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 30, y + (r() - 0.5) * 30); g.stroke(); }
  }, [1, 1]);
  // soft round glow
  T.glow = tex(64, 64, (g, w) => { const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); });
  // fog card: cloudy blob
  T.mist = tex(128, 128, (g, w) => {
    for (let i = 0; i < 26; i++) { const x = w * (0.25 + r() * 0.5), y = w * (0.35 + r() * 0.3), rad = w * (0.12 + r() * 0.22); const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, w, w); }
  });
  // moonbeam: soft vertical shaft
  T.beam = tex(64, 256, (g, w, h) => {
    const gx = g.createLinearGradient(0, 0, w, 0); gx.addColorStop(0, 'rgba(255,255,255,0)'); gx.addColorStop(0.5, 'rgba(255,255,255,1)'); gx.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gx; g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'destination-in';
    const gy = g.createLinearGradient(0, 0, 0, h); gy.addColorStop(0, 'rgba(0,0,0,0)'); gy.addColorStop(0.2, 'rgba(0,0,0,.8)'); gy.addColorStop(0.75, 'rgba(0,0,0,.5)'); gy.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gy; g.fillRect(0, 0, w, h);
  });
  // distant treeline silhouettes, wrapped around a cylinder
  T.treeline = (seed, dense) => tex(1024, 256, (g, w, h) => {
    const rr = makeRng(seed);
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#fff';
    for (let i = 0; i < dense; i++) {
      const x = rr() * w, tw = 3 + rr() * 9, top = h * (0.05 + rr() * 0.45);
      g.beginPath(); g.moveTo(x - tw, h); g.lineTo(x - tw * 0.4, top); g.lineTo(x + tw * 0.4, top); g.lineTo(x + tw, h); g.fill();
      for (let b = 0; b < 4; b++) { const by = top + rr() * (h - top) * 0.5, dir = rr() < 0.5 ? -1 : 1, bl = 10 + rr() * 30; g.lineWidth = 1 + rr() * 2; g.strokeStyle = '#fff'; g.beginPath(); g.moveTo(x, by); g.quadraticCurveTo(x + dir * bl * 0.5, by - bl * 0.6, x + dir * bl, by - bl * 0.3 - rr() * 20); g.stroke(); }
    }
    g.fillRect(0, h * 0.85, w, h * 0.15);
  });
  T.treeline1 = T.treeline(11, 120); T.treeline1.wrapS = THREE.RepeatWrapping; T.treeline1.repeat.set(3, 1);
  T.treeline2 = T.treeline(29, 170); T.treeline2.wrapS = THREE.RepeatWrapping; T.treeline2.repeat.set(4, 1);

  const M = {};
  M.bark = new THREE.MeshStandardMaterial({ map: T.bark, vertexColors: true, roughness: 0.95, metalness: 0, flatShading: true });
  M.flat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, flatShading: true });
  M.wood = new THREE.MeshStandardMaterial({ map: T.bark, vertexColors: true, roughness: 0.9, flatShading: true });
  // obstacles catch a little more moonlight than the forest around them, so they read in time
  M.obst = new THREE.MeshStandardMaterial({ map: T.bark, vertexColors: true, roughness: 0.85, flatShading: true, emissive: '#3a3f5e', emissiveIntensity: 0.48 });
  M.ground = new THREE.MeshStandardMaterial({ map: T.ground, vertexColors: true, roughness: 1, metalness: 0 });
  M.glowWarm = new THREE.SpriteMaterial({ map: T.glow, color: '#ffb35c', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  M.lampOn = new THREE.MeshBasicMaterial({ color: '#ffc477' });

  // ---------- geometry helpers ----------
  const tmpC = new THREE.Color();
  // Concatenate parts into one non-indexed geometry with vertex colours.
  function merge(parts) {
    let n = 0; const gs = [];
    for (const p of parts) { const g = (p.geo.index ? p.geo.toNonIndexed() : p.geo.clone()); if (p.m) g.applyMatrix4(p.m); gs.push([g, p]); n += g.attributes.position.count; }
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const [g, p] of gs) {
      const P = g.attributes.position, U = g.attributes.uv;
      for (let i = 0; i < P.count; i++) {
        const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
        pos[(o + i) * 3] = x; pos[(o + i) * 3 + 1] = y; pos[(o + i) * 3 + 2] = z;
        if (typeof p.color === 'function') p.color(x, y, z, tmpC); else tmpC.set(p.color || '#ffffff');
        col[(o + i) * 3] = tmpC.r; col[(o + i) * 3 + 1] = tmpC.g; col[(o + i) * 3 + 2] = tmpC.b;
        if (U) { uv[(o + i) * 2] = U.getX(i) * (p.uvs || 1); uv[(o + i) * 2 + 1] = U.getY(i) * (p.uvt || 1); }
      }
      o += P.count; g.dispose();
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('color', new THREE.BufferAttribute(col, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeVertexNormals();
    out.computeBoundingSphere();
    return out;
  }
  function jitter(geo, amt, rr) {
    const P = geo.attributes.position, seen = new Map();
    for (let i = 0; i < P.count; i++) {
      const k = Math.round(P.getX(i) * 100) + ',' + Math.round(P.getY(i) * 100) + ',' + Math.round(P.getZ(i) * 100);
      let d = seen.get(k); if (!d) { d = [(rr() - 0.5) * amt, (rr() - 0.5) * amt, (rr() - 0.5) * amt]; seen.set(k, d); }
      P.setXYZ(i, P.getX(i) + d[0], P.getY(i) + d[1], P.getZ(i) + d[2]);
    }
    return geo;
  }
  const M4 = () => new THREE.Matrix4();
  const mat = (x, y, z, rx, ry, rz, sx, sy, sz) => M4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0, 'YXZ')), new THREE.Vector3(sx || 1, sy || sx || 1, sz || sx || 1));
  // a tapered limb from a to b (cylinder along Y rotated to the segment)
  function limb(a, b, r0, r1, seg) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length();
    const g = new THREE.CylinderGeometry(r1, r0, len, seg || 5, 1, false); g.translate(0, len / 2, 0);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    return { geo: g, m: M4().compose(a.clone(), q, new THREE.Vector3(1, 1, 1)) };
  }
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const barkCol = (base, moss, top) => (x, y, z, c) => { const t = clamp(y / top, 0, 1); c.set(base).lerp(tmpC.set(moss), clamp(1 - y / 2.2, 0, 1) * 0.7); return c; };

  // ---------- trees ----------
  // variant 0: tall forest tree with sparse dark crown; 1: bare twisted; 2: distorted, leaning (later stages)
  function tree(variant, seed) {
    const rr = makeRng(seed), parts = [];
    const H = variant === 2 ? 11 : 13.5;
    const trunk = new THREE.CylinderGeometry(0.22, 0.62, H, 7, 10, false); trunk.translate(0, H / 2, 0);
    const P = trunk.attributes.position;
    const bx = rrange(rr, -1, 1) * (variant === 2 ? 2.4 : 0.8), bz = rrange(rr, -1, 1) * (variant === 2 ? 1.6 : 0.6), tw = variant === 1 ? 1.4 : variant === 2 ? 2.4 : 0.3;
    for (let i = 0; i < P.count; i++) {
      let x = P.getX(i), y = P.getY(i), z = P.getZ(i); const t = y / H;
      const a = tw * t, ca = Math.cos(a), sa = Math.sin(a);
      const nx = x * ca - z * sa, nz = x * sa + z * ca;
      const sw = variant === 2 ? Math.sin(t * 5.2) * 0.6 : Math.sin(t * 3) * 0.2;
      P.setXYZ(i, nx + bx * t * t + sw, y, nz + bz * t * t);
    }
    jitter(trunk, 0.09, rr);
    const bc = variant === 2 ? '#3a3046' : '#3b3a4a';
    parts.push({ geo: trunk, color: barkCol(bc, '#3d4a4a', H), uvt: 3 });
    // exposed root flares
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + rr() * 0.6, l = 1.2 + rr() * 1.2;
      parts.push(Object.assign(limb(V3(0, 0.9, 0), V3(Math.cos(a) * l, -0.15, Math.sin(a) * l), 0.28, 0.05, 5), { color: '#34333f' }));
    }
    // branches: crooked two-segment limbs
    const nb = variant === 0 ? 6 : variant === 1 ? 9 : 7;
    for (let i = 0; i < nb; i++) {
      const y = H * (0.4 + rr() * 0.55), t = y / H, a = rr() * Math.PI * 2;
      const base = V3(bx * t * t, y, bz * t * t);
      const up = variant === 1 ? 0.2 + rr() * 0.6 : 0.5 + rr() * 0.6, l1 = 1.4 + rr() * 2.2;
      const mid = base.clone().add(V3(Math.cos(a) * l1, up * l1, Math.sin(a) * l1));
      const a2 = a + (rr() - 0.5) * 1.6, l2 = 1 + rr() * 2;
      const tip = mid.clone().add(V3(Math.cos(a2) * l2, (variant === 2 ? -0.3 : 0.3) * l2 + (rr() - 0.5), Math.sin(a2) * l2));
      parts.push(Object.assign(limb(base, mid, 0.13, 0.07, 4), { color: bc }));
      parts.push(Object.assign(limb(mid, tip, 0.07, 0.015, 3), { color: bc }));
      if (variant === 0 && rr() < 0.75) {
        const cl = new THREE.IcosahedronGeometry(1 + rr() * 1.3, 0); jitter(cl, 0.5, rr);
        parts.push({ geo: cl, m: mat(tip.x, tip.y, tip.z, rr(), rr(), rr(), 1, 0.65, 1), color: rr() < 0.5 ? '#1c2236' : '#23263a' });
      }
    }
    return merge(parts);
  }
  const G = {};
  G.tree = [tree(0, 3), tree(1, 8), tree(2, 15)];
  // the great tree used as cover: wide trunk, hollow side
  G.bigTree = (() => {
    const rr = makeRng(91), parts = [];
    const t = new THREE.CylinderGeometry(0.9, 1.6, 15, 9, 8, false); t.translate(0, 7.5, 0); jitter(t, 0.22, rr);
    parts.push({ geo: t, color: barkCol('#3a3848', '#3e4c4a', 15), uvt: 3 });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * 6.28 + rr() * 0.4, l = 1.8 + rr() * 1.4; parts.push(Object.assign(limb(V3(0, 1.4, 0), V3(Math.cos(a) * (1.4 + l), -0.2, Math.sin(a) * (1.4 + l)), 0.5, 0.08, 5), { color: '#353441' })); }
    for (let i = 0; i < 6; i++) { const y = 8 + rr() * 6, a = rr() * 6.28, l = 3 + rr() * 3; const b = V3(0, y, 0), tip = V3(Math.cos(a) * l, y + 1 + rr() * 2, Math.sin(a) * l); parts.push(Object.assign(limb(b, tip, 0.3, 0.05, 4), { color: '#3a3848' })); }
    return merge(parts);
  })();
  G.bush = (() => {
    const rr = makeRng(5), parts = [];
    for (let i = 0; i < 6; i++) { const g = new THREE.IcosahedronGeometry(0.55 + rr() * 0.4, 0); jitter(g, 0.25, rr); parts.push({ geo: g, m: mat((rr() - 0.5) * 1.4, 0.35 + rr() * 0.4, (rr() - 0.5) * 1.1, rr(), rr(), rr(), 1, 0.8, 1), color: (x, y, z, c) => c.set('#1e2a33').lerp(tmpC.set('#36404e'), clamp(y / 1.2, 0, 1)) }); }
    return merge(parts);
  })();
  G.denseBush = (() => {
    const rr = makeRng(6), parts = [];
    for (let i = 0; i < 12; i++) { const g = new THREE.IcosahedronGeometry(0.7 + rr() * 0.5, 0); jitter(g, 0.3, rr); parts.push({ geo: g, m: mat((rr() - 0.5) * 2.6, 0.5 + rr() * 0.9, (rr() - 0.5) * 1.5, rr(), rr(), rr(), 1, 0.85, 1), color: (x, y, z, c) => c.set('#1a2530').lerp(tmpC.set('#34405a'), clamp(y / 1.9, 0, 1)) }); }
    return merge(parts);
  })();
  const rockCol = (x, y, z, c) => c.set('#363846').lerp(tmpC.set('#3f4d4b'), clamp((y - 0.3) / 0.9, 0, 1) * 0.8);
  G.rock = (() => { const rr = makeRng(12); const g = new THREE.DodecahedronGeometry(0.8, 0); jitter(g, 0.35, rr); return merge([{ geo: g, m: mat(0, 0.35, 0, 0, 0, 0, 1.2, 0.7, 1), color: rockCol }]); })();
  G.rocks = (() => {
    const rr = makeRng(13), parts = [];
    for (const [x, z, s, h] of [[0, 0, 1.4, 1.5], [-1.1, 0.5, 1, 1], [1.1, -0.3, 0.9, 0.9], [0.4, 0.9, 0.7, 0.6]]) { const g = new THREE.DodecahedronGeometry(s, 0); jitter(g, 0.4, rr); parts.push({ geo: g, m: mat(x, h * 0.55, z, rr(), rr(), rr(), 1, h / s, 1), color: rockCol }); }
    return merge(parts);
  })();
  // fallen log lying across the trail (along X), length 1 scaled per instance
  const logCol = (x, y, z, c) => c.set('#3c3542').lerp(tmpC.set('#405048'), clamp((y - 0.2) / 0.5, 0, 1) * 0.6);
  G.log = (() => {
    const rr = makeRng(21), parts = [];
    const g = new THREE.CylinderGeometry(0.42, 0.48, 9, 8, 6, false); jitter(g, 0.07, rr);
    parts.push({ geo: g, m: mat(0, 0.42, 0, 0, 0, Math.PI / 2), color: logCol, uvt: 3 });
    for (let i = 0; i < 4; i++) { const x = (rr() - 0.5) * 7; parts.push(Object.assign(limb(V3(x, 0.6, 0), V3(x + (rr() - 0.5), 1.3 + rr() * 0.6, (rr() - 0.5) * 1.2), 0.1, 0.03, 4), { color: '#3c3542' })); }
    return merge(parts);
  })();
  // hollow log used as cover, lying along the trail (along Z)
  G.hollowLog = (() => {
    const rr = makeRng(22), parts = [];
    const g = new THREE.CylinderGeometry(0.85, 0.95, 5, 9, 4, true); jitter(g, 0.1, rr);
    parts.push({ geo: g, m: mat(0, 0.85, 0, Math.PI / 2, 0, 0), color: logCol, uvt: 2 });
    const inner = new THREE.CylinderGeometry(0.7, 0.8, 4.9, 9, 1, true); inner.scale(-1, 1, 1);
    parts.push({ geo: inner, m: mat(0, 0.85, 0, Math.PI / 2, 0, 0), color: '#0c0b10' });
    for (let i = 0; i < 3; i++) { const z = (rr() - 0.5) * 4; parts.push(Object.assign(limb(V3(0, 1.6, z), V3((rr() - 0.5) * 0.8, 2.3, z + (rr() - 0.5)), 0.1, 0.03, 4), { color: '#3c3542' })); }
    return merge(parts);
  })();
  // exposed roots arching over the trail
  G.roots = (() => {
    const rr = makeRng(31), parts = [];
    for (let i = 0; i < 6; i++) { const g = new THREE.TorusGeometry(0.7 + rr() * 0.6, 0.09 + rr() * 0.06, 4, 9, Math.PI); jitter(g, 0.06, rr); parts.push({ geo: g, m: mat((i - 2.5) * 1.3 + (rr() - 0.5) * 0.4, -0.25, (rr() - 0.5) * 0.6, 0, (rr() - 0.5) * 0.6, 0, 1, 0.55 + rr() * 0.2, 1), color: '#3a3240' }); }
    const g = new THREE.CylinderGeometry(0.16, 0.2, 9, 5, 4); jitter(g, 0.08, rr); parts.push({ geo: g, m: mat(0, 0.05, 0.1, 0, 0, Math.PI / 2), color: '#3a3240' });
    return merge(parts);
  })();
  // brambles with pale thorns: 2.2 m wide cluster
  G.thorns = (() => {
    const rr = makeRng(41), parts = [];
    for (let i = 0; i < 14; i++) { const a = V3((rr() - 0.5) * 2, 0, (rr() - 0.5) * 0.8), b = a.clone().add(V3((rr() - 0.5) * 1.6, 0.8 + rr() * 0.9, (rr() - 0.5) * 0.8)); parts.push(Object.assign(limb(a, b, 0.06, 0.02, 3), { color: '#2a2030' })); for (let k = 0; k < 3; k++) { const t = rr(), p = a.clone().lerp(b, t); const sp = new THREE.ConeGeometry(0.035, 0.22, 3); sp.rotateZ(Math.PI / 2 + (rr() - 0.5)); parts.push({ geo: sp, m: mat(p.x, p.y, p.z, rr() * 3, rr() * 3, 0), color: '#b9b2a6' }); } }
    for (let i = 0; i < 5; i++) { const g = new THREE.IcosahedronGeometry(0.4 + rr() * 0.3, 0); jitter(g, 0.3, rr); parts.push({ geo: g, m: mat((rr() - 0.5) * 1.8, 0.3, (rr() - 0.5) * 0.6, 0, 0, 0, 1, 0.6, 1), color: '#231c2a' }); }
    return merge(parts);
  })();
  // collapsed branches: a heap of broken limbs
  G.branches = (() => {
    const rr = makeRng(51), parts = [];
    for (let i = 0; i < 9; i++) { const a = V3((rr() - 0.5) * 2.4, rr() * 0.4, (rr() - 0.5) * 1), b = V3((rr() - 0.5) * 2.4, 0.6 + rr() * 1, (rr() - 0.5) * 1); parts.push(Object.assign(limb(a, b, 0.12, 0.05, 4), { color: '#3b3444' })); parts.push(Object.assign(limb(b, b.clone().add(V3((rr() - 0.5) * 1.2, rr() * 0.4, (rr() - 0.5))), 0.05, 0.015, 3), { color: '#3b3444' })); }
    return merge(parts);
  })();
  // thick trunk standing in the trail (pairs make narrow gaps)
  G.gapTrunk = (() => { const rr = makeRng(61); const g = new THREE.CylinderGeometry(0.45, 0.7, 14, 8, 8, false); g.translate(0, 7, 0); jitter(g, 0.1, rr); const parts = [{ geo: g, color: barkCol('#3b3a4a', '#3e4c4a', 14), uvt: 3 }]; for (let i = 0; i < 5; i++) { const a = i * 1.26 + rr(), l = 1 + rr(); parts.push(Object.assign(limb(V3(0, 0.8, 0), V3(Math.cos(a) * l, -0.1, Math.sin(a) * l), 0.25, 0.05, 4), { color: '#34333f' })); } return merge(parts); })();
  // bridge plank (1 m across the trail, 0.35 m deep)
  G.plank = merge([{ geo: new THREE.BoxGeometry(1, 0.08, 0.32), color: '#5a4a46' }]);
  G.bridgeRail = (() => { const parts = []; for (let i = 0; i < 4; i++) { parts.push({ geo: new THREE.BoxGeometry(0.14, 1.3, 0.14), m: mat(0, 0.4, -3 + i * 2), color: '#4a3e3e' }); } parts.push({ geo: new THREE.BoxGeometry(0.08, 0.08, 6.4), m: mat(0, 0.95, 0, 0.05, 0, 0.04), color: '#4a3e3e' }); return merge(parts); })();
  // broken fence: two posts, one rail, one fallen rail
  G.fence = merge([
    { geo: new THREE.BoxGeometry(0.12, 1.1, 0.12), m: mat(-1.4, 0.5, 0, 0, 0, 0.08), color: '#4c423f' },
    { geo: new THREE.BoxGeometry(0.12, 0.9, 0.12), m: mat(1.4, 0.4, 0, 0.1, 0, -0.12), color: '#4c423f' },
    { geo: new THREE.BoxGeometry(3, 0.08, 0.06), m: mat(0, 0.75, 0, 0, 0, 0.03), color: '#5a4d48' },
    { geo: new THREE.BoxGeometry(1.8, 0.07, 0.06), m: mat(0.6, 0.15, 0.2, 0, 0.3, 0.25), color: '#5a4d48' }
  ]);
  // lantern post (lamp head handled separately so it can go out)
  G.lanternPost = merge([
    { geo: new THREE.CylinderGeometry(0.05, 0.07, 2.2, 5), m: mat(0, 1.1, 0), color: '#3a3236' },
    { geo: new THREE.BoxGeometry(0.5, 0.05, 0.05), m: mat(0.22, 2.15, 0), color: '#3a3236' },
    { geo: new THREE.BoxGeometry(0.26, 0.05, 0.26), m: mat(0.42, 1.98, 0), color: '#2a2426' },
    { geo: new THREE.ConeGeometry(0.2, 0.18, 4), m: mat(0.42, 1.65, 0, 0, Math.PI / 4), color: '#2a2426' }
  ]);
  G.lampHead = new THREE.BoxGeometry(0.17, 0.26, 0.17);
  // small abandoned shrine with a candle niche
  G.shrine = merge([
    { geo: new THREE.BoxGeometry(0.9, 0.6, 0.7), m: mat(0, 0.3, 0), color: '#3f3f4a' },
    { geo: new THREE.BoxGeometry(0.7, 0.7, 0.55), m: mat(0, 0.95, 0), color: '#4a3e3c' },
    { geo: new THREE.BoxGeometry(0.4, 0.38, 0.3), m: mat(0, 0.95, -0.15), color: '#110e10' },
    { geo: new THREE.ConeGeometry(0.75, 0.5, 4), m: mat(0, 1.55, 0, 0, Math.PI / 4, 0), color: '#2e2a30' }
  ]);
  // abandoned shack used as cover
  G.shed = (() => {
    const rr = makeRng(71), parts = [], wc = '#4a3f3e';
    for (let i = 0; i < 9; i++) { if (i === 5) continue; parts.push({ geo: new THREE.BoxGeometry(0.3, 2.2 - rr() * 0.4, 0.07), m: mat(-1.2 + i * 0.3, 1.05, 1.1, 0, 0, (rr() - 0.5) * 0.05), color: wc }); }
    for (let i = 0; i < 8; i++) { if (i === 2) continue; parts.push({ geo: new THREE.BoxGeometry(0.07, 2.0 - rr() * 0.5, 0.3), m: mat(-1.3, 1.0, -1 + i * 0.3, (rr() - 0.5) * 0.05, 0, 0), color: wc }); parts.push({ geo: new THREE.BoxGeometry(0.07, 2.1 - rr() * 0.3, 0.3), m: mat(1.3, 1.0, -1 + i * 0.3, 0, 0, 0), color: wc }); }
    for (let i = 0; i < 9; i++) { if (i === 3 || i === 6) continue; parts.push({ geo: new THREE.BoxGeometry(0.3, 2.3, 0.07), m: mat(-1.2 + i * 0.3, 1.1, -1.1, 0, 0, 0), color: wc }); }
    parts.push({ geo: new THREE.BoxGeometry(3.2, 0.08, 2.9), m: mat(0, 2.35, 0, 0.22, 0, 0.06), color: '#3a3134' });
    parts.push({ geo: new THREE.BoxGeometry(1.2, 0.08, 1.5), m: mat(0.9, 0.5, 1.6, 0.9, 0.3, 0.2), color: '#3a3134' });
    return merge(parts);
  })();
  // ground decal ring that marks cover
  G.ring = new THREE.RingGeometry(0.5, 1.15, 32); G.ring.rotateX(-Math.PI / 2);
  return { T, M, G, merge, jitter, mat, limb, V3 };
}

// ---- 02_rigs.js ----
// The hooded wanderer and the thing that follows it. Both face -z.
function createRigs(THREE, A) {
  const V3 = A.V3;
  const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const mesh = (geo, mat, parent, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; parent.add(m); return m; };

  // ---------- the wanderer ----------
  function makeWanderer() {
    const rr = makeRng(4);
    const cloth = new THREE.MeshStandardMaterial({ color: '#5f6c82', roughness: 0.95, flatShading: true });
    const dark = new THREE.MeshStandardMaterial({ color: '#465066', roughness: 0.95, flatShading: true });
    const leg = new THREE.MeshStandardMaterial({ color: '#2c2f3c', roughness: 0.9, flatShading: true });
    const voidM = new THREE.MeshBasicMaterial({ color: '#020205' });
    const root = new THREE.Group();
    const body = pivot(root, 0, 0.36, 0); // hips
    // legs below the hem
    const legs = [-1, 1].map(s => { const p = pivot(body, s * 0.09, 0, 0); const g = new THREE.CapsuleGeometry(0.055, 0.22, 3, 6); g.translate(0, -0.17, 0); mesh(g, leg, p); const foot = new THREE.BoxGeometry(0.09, 0.06, 0.16); foot.translate(0, -0.33, -0.03); mesh(foot, leg, p); return p; });
    const torso = pivot(body, 0, 0, 0);
    // cloak: jagged cone
    const cg = new THREE.ConeGeometry(0.36, 0.78, 9, 3, true); cg.translate(0, 0.27, 0);
    const P = cg.attributes.position;
    for (let i = 0; i < P.count; i++) if (P.getY(i) < -0.05) P.setY(i, P.getY(i) + (rr() - 0.5) * 0.09);
    const cloak = mesh(cg, cloth, torso); cloak.material.side = THREE.DoubleSide;
    // trailing cape panel that flutters
    const capeP = pivot(torso, 0, 0.58, 0.12);
    const capeG = new THREE.ConeGeometry(0.26, 0.62, 5, 2, true, Math.PI * 0.15, Math.PI * 0.7); capeG.rotateY(Math.PI); capeG.translate(0, -0.3, 0.06);
    const cape = mesh(capeG, dark, capeP); cape.material.side = THREE.DoubleSide;
    // arms
    const arms = [-1, 1].map(s => { const p = pivot(torso, s * 0.22, 0.52, 0); p.rotation.z = s * 0.18; const g = new THREE.CapsuleGeometry(0.06, 0.26, 3, 6); g.translate(0, -0.18, 0); mesh(g, dark, p); return p; });
    // oversized hood with a face lost in darkness
    const head = pivot(torso, 0, 0.66, 0);
    const hood = new THREE.SphereGeometry(0.3, 10, 8); hood.scale(1, 1.06, 1.12); hood.translate(0, 0.22, 0.02);
    mesh(hood, cloth, head);
    const tip = new THREE.ConeGeometry(0.17, 0.42, 6); tip.rotateX(Math.PI * 0.62); tip.translate(0, 0.32, 0.3);
    mesh(tip, cloth, head);
    const rim = new THREE.TorusGeometry(0.19, 0.045, 5, 12); rim.scale(1, 1.18, 1); rim.translate(0, 0.19, -0.27);
    mesh(rim, dark, head);
    const face = new THREE.SphereGeometry(0.2, 10, 8); face.scale(1, 1.15, 0.55); face.translate(0, 0.19, -0.24);
    head.add(new THREE.Mesh(face, voidM));
    const pose = { lean: 0, crouch: 0, legA: 0, legB: 0, arm: 0, armIn: 0, headP: 0, headY: 0, cape: 0, bob: 0, tuck: 0 };
    return { root, body, torso, legs, arms, head, capeP, pose, phase: 0, breath: 0 };
  }

  // state: 'idle' | 'run' | 'hide' | 'recover' | 'caught' | 'trip' | 'vault'
  function animateWanderer(w, state, speed, dt, k) {
    const p = w.pose, t = (w.breath += dt);
    let lean = 0.04, crouch = 0, legA = 0, arm = 0, armIn = 0, headP = 0, headY = Math.sin(t * 0.7) * 0.12, cape = 0.1 + Math.sin(t * 2) * 0.05, bob = Math.sin(t * 2.2) * 0.008, tuck = 0;
    if (state === 'run' || state === 'vault') {
      w.phase += dt * (4 + speed * 0.95);
      const s = Math.sin(w.phase);
      lean = 0.32 + speed * 0.012; legA = s * 0.95; arm = -s * 0.85; armIn = 0.1;
      bob = Math.abs(Math.cos(w.phase)) * 0.07; headP = -0.12 + (k.exhausted ? 0.25 : 0); headY = Math.sin(w.phase * 0.5) * 0.05;
      cape = 0.55 + speed * 0.05 + Math.sin(w.phase * 2.1) * 0.18;
      if (k.exhausted) { lean += 0.12; bob *= 0.6; headY += Math.sin(t * 9) * 0.06; }
      if (state === 'vault') { tuck = 1; legA = 0.9; arm = -1.2; }
    } else if (state === 'hide') {
      lean = 0.78; crouch = 0.24; tuck = 1.2; arm = -1.15; armIn = 0.75; headP = 0.5 + Math.sin(t * 2.4) * 0.03; headY = Math.sin(t * 0.4) * 0.05 + (k.peek || 0); cape = 0.05; bob = Math.sin(t * 3.2) * 0.012;
    } else if (state === 'recover') {
      lean = 0.62; crouch = 0.08; tuck = 0.45; arm = -0.7; armIn = 0.3; headP = 0.25 + Math.sin(t * 5) * 0.07; bob = Math.sin(t * 5) * 0.02; cape = 0.15;
    } else if (state === 'trip') {
      lean = 1.05; crouch = 0.12; legA = -0.6; arm = -1.4; armIn = -0.2; headP = 0.4; cape = 0.9;
    } else if (state === 'caught') {
      lean = -0.08; crouch = 0.03; arm = 0.25; armIn = -0.25; headP = -0.25; headY = k.look || 0; cape = 0.05; bob = 0;
    }
    const kk = state === 'caught' ? 6 : 12;
    p.lean = damp(p.lean, lean, kk, dt); p.crouch = damp(p.crouch, crouch, kk, dt); p.legA = damp(p.legA, legA, 18, dt); p.arm = damp(p.arm, arm, 16, dt);
    p.armIn = damp(p.armIn, armIn, 10, dt); p.headP = damp(p.headP, headP, 8, dt); p.headY = damp(p.headY, headY, state === 'caught' ? 3 : 8, dt); p.cape = damp(p.cape, cape, 10, dt); p.bob = damp(p.bob, bob, 20, dt); p.tuck = damp(p.tuck, tuck, 12, dt);
    w.body.position.y = 0.36 - p.crouch + p.bob;
    w.torso.rotation.x = -p.lean;
    w.legs[0].rotation.x = p.legA - p.tuck * 0.9; w.legs[1].rotation.x = -p.legA - p.tuck * 0.9;
    w.arms[0].rotation.x = p.arm; w.arms[1].rotation.x = -p.arm * (state === 'run' ? 1 : -1);
    w.arms[0].rotation.z = -0.18 + p.armIn * 0.5; w.arms[1].rotation.z = 0.18 - p.armIn * 0.5;
    w.head.rotation.x = p.headP + p.lean * -0.4; w.head.rotation.y = p.headY;
    w.capeP.rotation.x = p.cape;
  }

  // ---------- the follower ----------
  function makeFollower(opts) {
    const rr = makeRng(opts && opts.seed || 9);
    const skin = new THREE.MeshStandardMaterial({ color: '#09080d', roughness: 0.82, metalness: 0.05, flatShading: true });
    const root = new THREE.Group();
    const hips = pivot(root, 0, 2.35, 0);
    const legs = [-1, 1].map(s => {
      const thigh = pivot(hips, s * 0.16, 0, 0);
      const tg = new THREE.CylinderGeometry(0.07, 0.11, 1.2, 5); tg.translate(0, -0.6, 0); A.jitter(tg, 0.03, rr); mesh(tg, skin, thigh);
      const knee = pivot(thigh, 0, -1.2, 0);
      const sg = new THREE.CylinderGeometry(0.035, 0.07, 1.22, 5); sg.translate(0, -0.61, 0); A.jitter(sg, 0.02, rr); mesh(sg, skin, knee);
      const fg = new THREE.ConeGeometry(0.06, 0.4, 4); fg.rotateX(-Math.PI / 2); fg.translate(0, -1.2, -0.15); mesh(fg, skin, knee);
      return { thigh, knee };
    });
    const spine = pivot(hips, 0, 0, 0);
    const tg = new THREE.CylinderGeometry(0.2, 0.11, 1.55, 6, 4); tg.translate(0, 0.78, 0);
    const TP = tg.attributes.position; for (let i = 0; i < TP.count; i++) { const y = TP.getY(i); TP.setZ(i, TP.getZ(i) + Math.sin(y * 1.8) * 0.12); TP.setX(i, TP.getX(i) * (1 + Math.sin(y * 7) * 0.12)); }
    A.jitter(tg, 0.05, rr); mesh(tg, skin, spine);
    // vertebrae ridge
    for (let i = 0; i < 6; i++) { const k = new THREE.ConeGeometry(0.04, 0.12, 4); k.rotateX(Math.PI * 0.6); mesh(k, skin, spine, 0, 0.3 + i * 0.22, 0.18 + Math.sin((0.3 + i * 0.22) * 1.8) * 0.12); }
    const arms = [-1, 1].map(s => {
      const sh = pivot(spine, s * 0.27, 1.5 + (s > 0 ? 0.07 : -0.04), 0);
      const ug = new THREE.CylinderGeometry(0.045, 0.075, 1.25, 5); ug.translate(0, -0.62, 0); A.jitter(ug, 0.02, rr); mesh(ug, skin, sh);
      const el = pivot(sh, 0, -1.25, 0);
      const fg = new THREE.CylinderGeometry(0.03, 0.05, 1.35, 5); fg.translate(0, -0.67, 0); A.jitter(fg, 0.02, rr); mesh(fg, skin, el);
      const hand = pivot(el, 0, -1.35, 0);
      for (let f = 0; f < 4; f++) { const fgeo = new THREE.CylinderGeometry(0.008, 0.02, 0.5, 3); fgeo.translate(0, -0.25, 0); const fm = mesh(fgeo, skin, hand); fm.rotation.z = (f - 1.5) * 0.18; fm.rotation.x = -0.15 - (f % 2) * 0.12; }
      return { sh, el, hand, s };
    });
    const neck = pivot(spine, 0, 1.55, 0.05);
    const ng = new THREE.CylinderGeometry(0.04, 0.06, 0.5, 5); ng.translate(0, 0.25, 0); mesh(ng, skin, neck);
    const head = pivot(neck, 0, 0.48, 0);
    const hg = new THREE.SphereGeometry(0.2, 8, 7); hg.scale(0.85, 1.6, 1); hg.translate(0, 0.2, -0.04); A.jitter(hg, 0.03, rr); mesh(hg, skin, head);
    const eyes = [];
    const eyeMat = new THREE.MeshBasicMaterial({ color: opts && opts.eye || '#ffcf8a', fog: false, transparent: true });
    const glowMat = new THREE.SpriteMaterial({ map: A.T.glow, color: opts && opts.eye || '#ffb860', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), eyeMat); e.position.set(s * 0.075, 0.27 + (s > 0 ? 0.015 : 0), -0.2); head.add(e);
      const g = new THREE.Sprite(glowMat); g.scale.setScalar(0.42); g.position.copy(e.position); g.position.z -= 0.02; head.add(g);
      eyes.push(e, g);
    }
    root.traverse(o => { if (o.isMesh) o.castShadow = true; });
    return { root, hips, spine, legs, arms, neck, head, eyes, skin, eyeMat, glowMat, phase: 0, t: 0, twitch: { y: 0, p: 0, r: 0, ty: 0, tp: 0, tr: 0, next: 0 }, pose: { lean: 0.25, crouch: 0, reach: 0, spread: 0 } };
  }
  // state: 'walk' | 'stand' | 'search' | 'lunge' | 'loom'
  function animateFollower(m, state, speed, dt, k) {
    m.t += dt;
    const P = m.pose, tw = m.twitch;
    let lean = 0.28, crouch = 0, reach = 0, spread = 0, stride = 0;
    if (state === 'walk') { m.phase += dt * (1.2 + speed * 0.42); stride = clamp(speed / 6, 0.25, 1); lean = 0.3 + speed * 0.025; }
    else if (state === 'search') { m.phase += dt * 0.8; stride = 0.12; lean = 0.95; crouch = 0.75; reach = 0.6; }
    else if (state === 'lunge') { lean = 0.55 + (k.close || 0) * 0.3; crouch = 0.2; reach = 1; spread = 1 - (k.close || 0); }
    else if (state === 'loom') { lean = 0.62; crouch = 0.1; reach = 0.35; m.phase += dt * 0.5; }
    else { m.phase += dt * 0.4; }
    P.lean = damp(P.lean, lean, 4, dt); P.crouch = damp(P.crouch, crouch, 3, dt); P.reach = damp(P.reach, reach, state === 'lunge' ? 9 : 3, dt); P.spread = damp(P.spread, spread, 6, dt);
    const s = Math.sin(m.phase), c = Math.cos(m.phase);
    m.hips.position.y = 2.35 - P.crouch + Math.abs(c) * 0.12 * stride;
    m.hips.rotation.z = s * 0.06 * stride; m.hips.rotation.y = s * 0.08 * stride;
    m.legs[0].thigh.rotation.x = s * 0.55 * stride - P.crouch * 0.9; m.legs[1].thigh.rotation.x = -s * 0.55 * stride - P.crouch * 0.9;
    m.legs[0].knee.rotation.x = Math.max(0, -c) * 0.9 * stride + P.crouch * 1.6; m.legs[1].knee.rotation.x = Math.max(0, c) * 0.9 * stride + P.crouch * 1.6;
    m.spine.rotation.x = -P.lean + Math.sin(m.t * 0.9) * 0.03; m.spine.rotation.z = Math.sin(m.t * 0.53) * 0.05;
    for (const a of m.arms) {
      const sw = (a.s > 0 ? s : -s) * 0.35 * stride;
      a.sh.rotation.x = sw - P.reach * 1.25 + Math.sin(m.t * 1.3 + a.s) * 0.05;
      a.sh.rotation.z = a.s * (0.1 + P.spread * 1.1 + Math.sin(m.t * 0.7 + a.s * 2) * 0.04);
      a.el.rotation.x = -0.25 - P.reach * 0.5 - Math.max(0, sw) * 0.3 + (state === 'search' ? Math.sin(m.t * 2.3 + a.s) * 0.4 : 0);
      a.el.rotation.z = -a.s * P.spread * 0.6;
      a.hand.rotation.x = -0.3 - P.reach * 0.4;
    }
    // the head moves on its own: slow drift punctuated by sudden snaps
    if (m.t > tw.next) { tw.ty = (Math.random() - 0.5) * (state === 'search' ? 2.2 : 0.9); tw.tp = (Math.random() - 0.3) * 0.6; tw.tr = (Math.random() - 0.5) * 0.9; tw.next = m.t + 0.4 + Math.random() * (state === 'search' ? 0.8 : 2.2); }
    tw.y = damp(tw.y, tw.ty, 14, dt); tw.p = damp(tw.p, tw.tp, 12, dt); tw.r = damp(tw.r, tw.tr, 10, dt);
    m.neck.rotation.x = P.lean * 0.7 - 0.2;
    m.head.rotation.set(tw.p + (k.headP || 0), tw.y + (k.headY || 0), tw.r);
    const eo = k.eyes == null ? 1 : k.eyes;
    m.glowMat.opacity = eo; m.eyeMat.opacity = eo;
  }
  return { makeWanderer, animateWanderer, makeFollower, animateFollower };
}

// ---- 03_world.js ----
// The endless forest: streamed chunks, pooled instances, cover, obstacles, lanterns.
function createWorld(THREE, A, scene, small) {
  const L = 24, AHEAD = small ? 6 : 7, BEHIND = 2;
  const _p = { x: 0, z: 0 }, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);

  // ---------- instance pools ----------
  function Pool(geo, mat, cap, shadow, receive) {
    const mesh = new THREE.InstancedMesh(geo, mat, cap);
    mesh.castShadow = !!shadow; mesh.receiveShadow = receive !== false; mesh.frustumCulled = false;
    const free = [];
    for (let i = cap - 1; i >= 0; i--) { mesh.setMatrixAt(i, ZERO); mesh.setColorAt(i, _c.set('#ffffff')); free.push(i); }
    scene.add(mesh);
    const pool = { mesh, free, dirty: true, cap };
    pool.add = (x, y, z, yaw, sx, sy, sz, tx, tz, color) => {
      const i = free.pop(); if (i === undefined) return -1;
      _e.set(tx || 0, yaw || 0, tz || 0); _q.setFromEuler(_e);
      _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy == null ? sx : sy, sz == null ? sx : sz));
      mesh.setMatrixAt(i, _m); mesh.setColorAt(i, _c.set(color || '#ffffff')); pool.dirty = true; return i;
    };
    pool.set = (i, x, y, z, yaw, sx, sy, sz, tx, tz) => { _e.set(tx || 0, yaw || 0, tz || 0); _q.setFromEuler(_e); _m.compose(_v.set(x, y, z), _q, _s.set(sx, sy == null ? sx : sy, sz == null ? sx : sz)); mesh.setMatrixAt(i, _m); pool.dirty = true; };
    pool.remove = i => { if (i < 0) return; mesh.setMatrixAt(i, ZERO); free.push(i); pool.dirty = true; };
    pool.flush = () => { if (pool.dirty) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; pool.dirty = false; } };
    return pool;
  }
  const N = AHEAD + BEHIND + 2;
  const P = {
    tree0: Pool(A.G.tree[0], A.M.bark, N * 18, true), tree1: Pool(A.G.tree[1], A.M.bark, N * 14, true), tree2: Pool(A.G.tree[2], A.M.bark, N * 14, true),
    bigTree: Pool(A.G.bigTree, A.M.bark, 14, true), bush: Pool(A.G.bush, A.M.flat, N * 14, false), denseBush: Pool(A.G.denseBush, A.M.flat, 24, true),
    rock: Pool(A.G.rock, A.M.flat, N * 8, false), rocks: Pool(A.G.rocks, A.M.flat, 16, true), log: Pool(A.G.log, A.M.obst, 18, true), hollowLog: Pool(A.G.hollowLog, A.M.bark, 12, true),
    roots: Pool(A.G.roots, A.M.obst, 14, true), thorns: Pool(A.G.thorns, A.M.obst, 30, true), branches: Pool(A.G.branches, A.M.obst, 22, true), gapTrunk: Pool(A.G.gapTrunk, A.M.obst, 18, true),
    plank: Pool(A.G.plank, A.M.obst, 160, true), rail: Pool(A.G.bridgeRail, A.M.obst, 10, true), fence: Pool(A.G.fence, A.M.wood, N * 4, true), post: Pool(A.G.lanternPost, A.M.flat, 24, true),
    shrine: Pool(A.G.shrine, A.M.flat, 12, true), shed: Pool(A.G.shed, A.M.wood, 12, true)
  };
  // crossed moonbeam planes
  const beamGeo = (() => { const a = new THREE.PlaneGeometry(2.6, 16); a.translate(0, 8, 0); const b = a.clone(); b.rotateY(Math.PI / 2); const g = new THREE.BufferGeometry(); const pa = a.toNonIndexed(), pb = b.toNonIndexed(); const pos = new Float32Array([...pa.attributes.position.array, ...pb.attributes.position.array]); const uv = new Float32Array([...pa.attributes.uv.array, ...pb.attributes.uv.array]); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return g; })();
  const beamMat = new THREE.MeshBasicMaterial({ map: A.T.beam, color: '#7f90cc', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  P.beam = Pool(beamGeo, beamMat, N * 2, false, false);
  // drifting mist cards (camera-facing, faded near the lens and into the distance)
  const mistMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: A.T.mist }, color: { value: new THREE.Color('#8590c0') }, opacity: { value: 0.5 }, time: { value: 0 }, far: { value: 90 } },
    vertexShader: `varying vec2 vUv; varying float vA; uniform float time; uniform float far;
      void main(){ vUv = uv; vec4 c = modelViewMatrix * instanceMatrix * vec4(0.,0.,0.,1.); float sc = length(instanceMatrix[0].xyz);
      c.xy += position.xy * sc * vec2(1.6, 0.55); c.x += sin(time * 0.13 + instanceMatrix[3].x * 0.3) * 0.8; gl_Position = projectionMatrix * c;
      float d = -c.z; vA = smoothstep(1.5, 7.0, d) * (1.0 - smoothstep(far * 0.55, far, d)); }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 color; uniform float opacity; varying vec2 vUv; varying float vA;
      void main(){ float a = texture2D(map, vUv).a * opacity * vA; if (a < 0.003) discard; gl_FragColor = vec4(color, a); }`,
    transparent: true, depthWrite: false
  });
  P.mist = Pool(new THREE.PlaneGeometry(1, 1), mistMat, N * 7, false, false);
  P.mist.mesh.renderOrder = 5;
  // ground decal marking cover within reach
  const ringMat = new THREE.MeshBasicMaterial({ map: A.T.glow, color: '#ffb766', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(new THREE.CircleGeometry(1.5, 24).rotateX(-Math.PI / 2), ringMat); ring.renderOrder = 4; scene.add(ring);

  // ---------- lanterns (the warm lights) ----------
  const lampPool = [];
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group();
    const head = new THREE.Mesh(A.G.lampHead, new THREE.MeshBasicMaterial({ color: '#ffc477' })); g.add(head);
    const glow = new THREE.Sprite(A.M.glowWarm.clone()); glow.scale.setScalar(2.2); g.add(glow);
    g.visible = false; scene.add(g); lampPool.push({ g, head, glow, used: false });
  }
  const lights = [];
  for (let i = 0; i < (small ? 2 : 3); i++) { const l = new THREE.PointLight('#ffad55', 0, 13, 1.6); scene.add(l); lights.push(l); }

  // ---------- ground chunks ----------
  const GW = 84, GX = 28, GZ = 10;
  const groundPool = [];
  function makeGround() {
    const g = new THREE.PlaneGeometry(GW, L, GX, GZ); g.rotateX(-Math.PI / 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3));
    const m = new THREE.Mesh(g, A.M.ground); m.receiveShadow = true; m.frustumCulled = false; scene.add(m); return m;
  }
  const cDirt = new THREE.Color('#8e88a6'), cEdge = new THREE.Color('#3e485c'), cMoss = new THREE.Color('#2a3444'), cDeep = new THREE.Color('#191e2c'), cLeaf = new THREE.Color('#71667c');
  function shapeGround(m, s0, halfW) {
    const g = m.geometry, Pp = g.attributes.position, C = g.attributes.color, U = g.attributes.uv;
    for (let j = 0; j <= GZ; j++) for (let i = 0; i <= GX; i++) {
      const k = j * (GX + 1) + i;
      const s = s0 + L - (j / GZ) * L; // row 0 is the far edge (more negative z)
      const cx = TRAIL.x(s), x = cx + (i / GX - 0.5) * GW, z = -s;
      const y = groundY(x, z);
      Pp.setXYZ(k, x, y, z);
      const off = Math.abs(x - cx), n = fbm(x * 0.3, z * 0.3);
      _c.copy(cDirt).lerp(cLeaf, n * 0.6);
      _c.lerp(cEdge, smooth((off - halfW * 0.75) / 1.6));
      _c.lerp(cMoss, smooth((off - halfW - 1.5) / 4) * (0.6 + n * 0.4));
      _c.lerp(cDeep, smooth((off - 12) / 20));
      if (y < -0.6) _c.lerp(cDeep, clamp(-y / 2.4, 0, 1));
      C.setXYZ(k, _c.r, _c.g, _c.b);
      U.setXY(k, x * 0.22, z * 0.22);
    }
    Pp.needsUpdate = true; C.needsUpdate = true; U.needsUpdate = true;
    g.computeVertexNormals();
  }

  // ---------- planner and chunk streaming ----------
  let rng, plan, chunks, spots, obstacles, lanterns, fallers, first, lastIdx = -999;
  const place = (s, u, out) => { trailPoint(s, u, out || _p); const o = out || _p; o.y = groundY(o.x, o.z); return o; };
  function addInst(ch, pool, s, u, yawOff, sx, sy, sz, tx, tz, color, ySink) {
    const p = place(s, u);
    const i = pool.add(p.x, p.y - (ySink || 0), p.z, TRAIL.yaw(s) + (yawOff || 0), sx, sy, sz, tx, tz, color);
    if (i >= 0) ch.insts.push([pool, i]);
    return i;
  }
  const tint = (r, base) => { const v = 0.82 + r() * 0.3; return _c.set(base || '#ffffff').multiplyScalar(v).getStyle(); };

  const SPOT = {
    bigTree: { obj: 2.0, hide: 4.05, label: 'tree' },
    hollowLog: { obj: 1.45, hide: 1.45, label: 'log', inside: true },
    rocks: { obj: 1.5, hide: 3.0, label: 'rocks' },
    denseBush: { obj: 1.7, hide: 1.8, label: 'bush', inside: true },
    shed: { obj: 2.6, hide: 2.6, label: 'shed', inside: true }
  };
  function makeSpot(ch, s) {
    const st = stageIndex(s), halfW = stageParam(s, 'halfW');
    const kinds = st === 0 ? ['bigTree', 'bigTree', 'rocks', 'denseBush', 'hollowLog'] : st === 1 ? ['bigTree', 'denseBush', 'hollowLog', 'rocks', 'denseBush'] : st === 2 ? ['shed', 'bigTree', 'hollowLog', 'rocks', 'shed'] : ['bigTree', 'shed', 'rocks', 'hollowLog', 'denseBush'];
    const kind = first.spot ? (first.spot = false, 'bigTree') : rpick(rng, kinds);
    const side = rng() < 0.5 ? -1 : 1, def = SPOT[kind];
    const spot = { s, side, kind, objU: side * (halfW + def.obj), hideU: side * (halfW + def.hide), inside: !!def.inside, halfW };
    const yaw = rng() * 6.28;
    if (kind === 'bigTree') addInst(ch, P.bigTree, s, spot.objU, yaw, 1, 1.05, 1, 0, 0, tint(rng));
    else if (kind === 'hollowLog') addInst(ch, P.hollowLog, s, spot.objU, 0, 1, 1, 1, 0, 0, tint(rng));
    else if (kind === 'rocks') addInst(ch, P.rocks, s, spot.objU, yaw, 1.15, 1.1, 1.15, 0, 0, tint(rng));
    else if (kind === 'denseBush') addInst(ch, P.denseBush, s, spot.objU, side > 0 ? 0 : Math.PI, 1.05, 1.05, 1.05, 0, 0, tint(rng));
    else if (kind === 'shed') addInst(ch, P.shed, s, spot.objU, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1, 1, 1, 0, 0, tint(rng));
    spots.push(spot); ch.spots.push(spot);
    return spot;
  }
  // obstacle blocks are lateral ranges [a, b] relative to the trail centre
  function makeObstacle(ch, s, kind) {
    const halfW = stageParam(s, 'halfW'), INF = 99, o = { s, kind, low: false, blocks: [], len: 0.9, hit: false, halfW };
    const yawJ = (rng() - 0.5) * 0.12;
    if (kind === 'log') { o.low = true; o.blocks = [[-INF, INF]]; addInst(ch, P.log, s, (rng() - 0.5) * 0.6, yawJ, 1, 1, 1, 0, 0, tint(rng)); }
    else if (kind === 'roots') { o.low = true; o.blocks = [[-INF, INF]]; o.len = 0.7; addInst(ch, P.roots, s, 0, yawJ, 1, 1, 1, 0, 0, tint(rng)); }
    else if (kind === 'thorns' || kind === 'branches') {
      const w = kind === 'thorns' ? 2.2 : 2.6, mode = rng();
      const c = mode < 0.42 ? -(halfW - w / 2 + 0.25) : mode < 0.84 ? (halfW - w / 2 + 0.25) : 0;
      o.blocks = [[c - w / 2 - 0.05, c + w / 2 + 0.05]];
      if (c === 0) o.blocks[0] = [-1.15, 1.15];
      addInst(ch, kind === 'thorns' ? P.thorns : P.branches, s, c, (rng() < 0.5 ? 0 : Math.PI) + yawJ, 1, 1, 1, 0, 0, tint(rng));
      // keep the blocked side reading as blocked right to the trail edge
      if (c !== 0) addInst(ch, P.bush, s + 0.2, Math.sign(c) * (halfW + 0.7), rng() * 6, 0.9, 0.9, 0.9, 0, 0, tint(rng));
      else for (const sd of [-1, 1]) addInst(ch, P.bush, s, sd * (halfW + 0.6), rng() * 6, 0.8, 0.8, 0.8, 0, 0, tint(rng));
    } else if (kind === 'gap') {
      const g = (rng() - 0.5) * (halfW - 1.0) * 2;
      o.blocks = [[-INF, g - 0.72], [g + 0.72, INF]]; o.len = 1.2;
      for (const sd of [-1, 1]) addInst(ch, P.gapTrunk, s, g + sd * 1.35, rng() * 6, 1, 1, 1, 0, 0, tint(rng));
      for (const sd of [-1, 1]) { const from = g + sd * 2, to = sd * (halfW + 0.6); if ((to - from) * sd > 0.4) addInst(ch, P.thorns, s, (from + to) / 2, rng() * 6, Math.abs(to - from) / 2.2 + 0.2, 1, 1, 0, 0, tint(rng)); }
    } else if (kind === 'bridge') {
      const half = 3.4; o.len = half * 2; o.blocks = [];
      RAVINES.push({ s, half });
      const holes = [], nh = rng() < 0.5 ? 1 : 2, w = halfW * 2 + 0.6;
      if (nh === 1) { const c = (rng() < 0.5 ? -1 : 1) * rrange(rng, 0.4, halfW - 0.9); holes.push([c - 0.75, c + 0.75]); }
      else { holes.push([-halfW - 0.3, -halfW + 1.1]); holes.push([halfW - 1.1, halfW + 0.3]); if (rng() < 0.5) { holes.length = 1; holes.push([0.2, 1.5]); } }
      o.blocks = holes;
      for (let z = -half + 0.2; z <= half; z += 0.42) {
        for (let u = -w / 2 + 0.5; u <= w / 2 - 0.4; u += 1) {
          if (holes.some(h => u + 0.45 > h[0] && u - 0.45 < h[1])) { if (rng() < 0.15) addInst(ch, P.plank, s + z, u, (rng() - 0.5) * 0.6, 0.7, 1, 1, 0.4, 0.6, '#cccccc', 0.9 + rng() * 0.6); continue; }
          const pt = place(s + z, u); const i = P.plank.add(pt.x, 0.02 + (rng() - 0.5) * 0.03, pt.z, TRAIL.yaw(s + z) + (rng() - 0.5) * 0.05, 1.02, 1, 1, 0, (rng() - 0.5) * 0.04, tint(rng)); if (i >= 0) ch.insts.push([P.plank, i]);
        }
      }
      for (const sd of [-1, 1]) { const pt = place(s, sd * (w / 2 + 0.1)); const i = P.rail.add(pt.x, 0, pt.z, TRAIL.yaw(s), 1, 1, 1, 0, sd * 0.06, tint(rng)); if (i >= 0) ch.insts.push([P.rail, i]); }
    }
    obstacles.push(o); ch.obstacles.push(o);
    return o;
  }
  function addLantern(ch, s, u, small) {
    const lp = lampPool.find(l => !l.used); if (!lp) return;
    const pt = place(s, u), yaw = TRAIL.yaw(s) + (u > 0 ? Math.PI : 0);
    if (!small) { const i = P.post.add(pt.x, pt.y, pt.z, yaw, 1, 1, 1, 0, 0); if (i >= 0) ch.insts.push([P.post, i]); }
    lp.used = true; lp.g.visible = true;
    // the lamp hangs 0.42 m out from the post toward the trail
    const ox = Math.cos(yaw) * 0.42, oz = -Math.sin(yaw) * 0.42;
    if (small) lp.g.position.set(pt.x, pt.y + 0.98, pt.z); else lp.g.position.set(pt.x + ox, pt.y + 1.86, pt.z + oz);
    lp.head.visible = !small; lp.glow.scale.setScalar(small ? 0.9 : 2.4);
    const L = { lp, s, u, lit: 1, flicker: 0, dying: 0, small, phase: rng() * 10 };
    lanterns.push(L); ch.lanterns.push(L);
  }
  function genChunk(idx) {
    const s0 = idx * L, s1 = s0 + L;
    const ch = { idx, s0, insts: [], spots: [], obstacles: [], lanterns: [], ground: groundPool.pop() || makeGround() };
    const halfW = stageParam(s0 + L / 2, 'halfW'), st = stageIndex(s0);
    // cover first, then obstacles kept clear of it
    while (plan.hide < s1) { if (plan.hide >= s0) makeSpot(ch, plan.hide); const g = STAGES[st].hideGap; plan.hide += rrange(rng, g[0], g[1]) * (plan.hide < 120 ? 0.85 : 1); }
    while (plan.obs < s1) {
      let s = plan.obs;
      if (s >= s0) {
        const near = spots.find(sp => s - sp.s > -7 && s - sp.s < 12);
        if (near) s = near.s + 12.5;
        const kinds = st === 0 ? ['log', 'roots', 'thorns', 'log'] : st === 1 ? ['log', 'thorns', 'branches', 'gap', 'roots'] : st === 2 ? ['gap', 'bridge', 'thorns', 'branches', 'log', 'roots'] : ['gap', 'bridge', 'thorns', 'branches', 'log', 'gap'];
        let kind = first.obs ? (first.obs = false, 'log') : rpick(rng, kinds);
        if (kind === 'bridge' && (s < s0 + 6 || s > s1 - 6 || spots.some(sp => Math.abs(sp.s - s) < 10))) kind = 'thorns';
        if (s < s1) {
          makeObstacle(ch, s, kind);
          // later stages pair obstacles into short sequences
          const s2 = s + 8.5 + rng() * 2;
          if (st >= 2 && rng() < 0.4 + st * 0.1 && s2 < s1 && kind !== 'bridge' && !spots.some(sp => s2 - sp.s > -7 && s2 - sp.s < 12)) makeObstacle(ch, s2, rpick(rng, ['thorns', 'branches', 'log', 'roots']));
        }
      }
      const g = STAGES[st].obsGap; plan.obs = Math.max(plan.obs, s) + rrange(rng, g[0], g[1]);
    }
    shapeGround(ch.ground, s0, halfW);
    // trees: dense walls with a few sentinels close to the trail
    const nt = Math.round(stageParam(s0, 'trees')), twist = stageParam(s0, 'twist'), dead = stageParam(s0, 'dead');
    for (let i = 0; i < nt; i++) {
      const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1, off = halfW + 1.5 + Math.pow(rng(), 1.5) * 26;
      // keep cover readable, and the hiding view clear
      if (spots.some(sp => s - sp.s > -4 && s - sp.s < 14.5 && Math.sign(sp.objU) === side && off < halfW + 8.5)) continue;
      if (RAVINES.some(r => Math.abs(r.s - s) < r.half + 1.5)) continue;
      const v = rng(), pool = v < dead ? P.tree1 : v < dead + twist ? P.tree2 : P.tree0;
      const sc = 0.75 + rng() * 0.6;
      addInst(ch, pool, s, side * off, rng() * 6.28, sc, sc * (0.9 + rng() * 0.3), sc, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1, tint(rng), 0.1);
    }
    const clearView = (s, side, off) => spots.some(sp => s - sp.s > -3 && s - sp.s < 14.5 && Math.sign(sp.objU) === side && off < halfW + 8.5);
    for (let i = 0; i < 10; i++) { const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1, off = halfW + 0.9 + Math.pow(rng(), 2) * 14; if (clearView(s, side, off)) continue; const sc = 0.6 + rng() * 0.8; addInst(ch, P.bush, s, side * off, rng() * 6, sc, sc * (0.7 + rng() * 0.5), sc, 0, 0, tint(rng)); }
    for (let i = 0; i < 4; i++) { const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1, off = halfW + 0.6 + rng() * 10; if (clearView(s, side, off)) continue; const sc = 0.4 + rng() * 0.9; addInst(ch, P.rock, s, side * off, rng() * 6, sc, sc, sc, 0, 0, tint(rng), 0.05); }
    if (st < 3 && rng() < 0.4) { const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1; addInst(ch, P.fence, s, side * (halfW + 0.4 + rng() * 0.4), Math.PI / 2 + (rng() - 0.5) * 0.3, 1, 1, 1, 0, (rng() - 0.5) * 0.2, tint(rng)); }
    // lanterns, shrines and abandoned structures
    if (rng() < stageParam(s0, 'lantern')) { const s = s0 + 4 + rng() * (L - 8); if (!obstacles.some(o => Math.abs(o.s - s) < 3)) addLantern(ch, s, (rng() < 0.5 ? -1 : 1) * (halfW + 0.45)); }
    if (rng() < stageParam(s0, 'struct')) {
      const s = s0 + rng() * L, side = rng() < 0.5 ? -1 : 1;
      if (!spots.some(sp => Math.abs(sp.s - s) < 6)) {
        if (st >= 2 && rng() < 0.5) addInst(ch, P.shed, s, side * (halfW + 6 + rng() * 6), rng() * 6, 1, 1, 1, 0.05, 0.08, tint(rng));
        else { const u = side * (halfW + 1.2 + rng() * 2); addInst(ch, P.shrine, s, u, side > 0 ? -Math.PI / 2 : Math.PI / 2, 1, 1, 1, 0, 0, tint(rng)); if (rng() < 0.8) { const i = lampPool.find(l => !l.used); if (i) addLantern(ch, s, u, true); } }
      }
    }
    for (let i = 0; i < (st >= 3 ? 1 : 2); i++) if (rng() < 0.6) { const s = s0 + rng() * L, u = (rng() - 0.5) * 2 * (halfW + 6); addInst(ch, P.beam, s, u, 0, 1 + rng() * 0.6, 1, 1, 0.42, 0.12); }
    for (let i = 0; i < 6; i++) { const s = s0 + rng() * L, u = (rng() < 0.5 ? -1 : 1) * (halfW + 1.5 + rng() * 10); const p = place(s, u); const sc = 5 + rng() * 7; const k = P.mist.add(p.x, p.y + 0.6 + rng() * 0.9, p.z, 0, sc, sc, sc); if (k >= 0) ch.insts.push([P.mist, k]); }
    chunks.push(ch);
  }
  function dropChunk(ch) {
    for (const [pool, i] of ch.insts) pool.remove(i);
    for (const sp of ch.spots) spots.splice(spots.indexOf(sp), 1);
    for (const o of ch.obstacles) obstacles.splice(obstacles.indexOf(o), 1);
    for (const l of ch.lanterns) { l.lp.used = false; l.lp.g.visible = false; lanterns.splice(lanterns.indexOf(l), 1); }
    groundPool.push(ch.ground);
  }

  // ---------- a tree that falls across the trail ----------
  const fallMesh = new THREE.Mesh(A.G.tree[1], A.M.obst); fallMesh.castShadow = true; fallMesh.visible = false; scene.add(fallMesh);
  function spawnFaller(s) {
    if (fallers.length || obstacles.some(o => Math.abs(o.s - s) < 8) || spots.some(sp => Math.abs(sp.s - s) < 8) || RAVINES.some(r => Math.abs(r.s - s) < 8)) return null;
    const halfW = stageParam(s, 'halfW'), side = rng() < 0.5 ? -1 : 1, base = place(s, side * (halfW + 1.2), {});
    const f = { s, side, base, t: -1, done: false, o: null, halfW };
    fallers.push(f);
    fallMesh.visible = true; fallMesh.position.set(base.x, base.y, base.z); fallMesh.rotation.set(0, TRAIL.yaw(s), 0); fallMesh.scale.setScalar(0.85);
    return f;
  }
  function updateFallers(dt, ps) {
    for (const f of fallers) {
      if (f.t < 0) { if (f.s - ps < 30) { f.t = 0; f.started = true; } continue; }
      f.t += dt;
      const a = Math.min(1, Math.pow(f.t / 1.1, 2.2)) * (Math.PI / 2 - 0.08);
      // topple toward the far side of the trail
      fallMesh.rotation.set(0, TRAIL.yaw(f.s), -f.side * a, 'YXZ');
      if (f.t >= 1.1 && !f.done) {
        f.done = true; f.landed = true;
        f.o = { s: f.s, kind: 'fallen', low: true, blocks: [[-99, 99]], len: 0.9, hit: false };
        obstacles.push(f.o);
      }
    }
    for (let i = fallers.length - 1; i >= 0; i--) if (fallers[i].s < ps - 30) { const f = fallers[i]; if (f.o && obstacles.includes(f.o)) obstacles.splice(obstacles.indexOf(f.o), 1); fallers.splice(i, 1); fallMesh.visible = false; }
  }

  // ---------- distant treeline layers following the camera ----------
  const lineMats = [], lines = [];
  for (const [rad, h, t, op] of [[150, 64, A.T.treeline1, 0.5], [105, 46, A.T.treeline2, 0.75]]) {
    const m = new THREE.MeshBasicMaterial({ map: t, color: '#0c0f20', transparent: true, opacity: op, side: THREE.BackSide, depthWrite: false, fog: false });
    const c = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, h, 48, 1, true), m); c.position.y = h / 2 - 4; c.renderOrder = -5; c.frustumCulled = false; scene.add(c); lineMats.push(m); lines.push(c);
  }

  // ---------- public ----------
  function reset(seed, from) {
    if (chunks) for (const ch of chunks) dropChunk(ch);
    RAVINES.length = 0;
    rng = makeRng(seed); chunks = []; spots = []; obstacles = []; lanterns = []; fallers = []; fallMesh.visible = false;
    from = from || 0; lastIdx = -999;
    plan = { hide: from + 34, obs: from + (from ? 26 : 112) }; first = { spot: true, obs: !from };
    for (const l of lampPool) { l.used = false; l.g.visible = false; }
  }
  function stream(ps) {
    const ci = Math.floor(ps / L);
    if (ci === lastIdx && chunks.length) return;
    lastIdx = ci;
    while (chunks.length && chunks[0].idx < ci - BEHIND) dropChunk(chunks.shift());
    let next = chunks.length ? chunks[chunks.length - 1].idx + 1 : ci - BEHIND;
    while (next <= ci + AHEAD) genChunk(next++);
    for (let i = RAVINES.length - 1; i >= 0; i--) if (RAVINES[i].s < ps - 80) RAVINES.splice(i, 1);
  }
  function update(ps, dt, time, cam) {
    stream(ps);
    updateFallers(dt, ps);
    mistMat.uniforms.time.value = time;
    for (const c of lines) { c.position.x = cam.position.x; c.position.z = cam.position.z; }
    // lanterns: flicker, die, and borrow the few real lights
    for (const l of lanterns) {
      if (l.dying > 0) { l.dying -= dt; l.lit = l.dying > 0 ? (Math.random() < 0.5 ? 0.1 : 1) * (l.dying / 0.9) : 0; }
      const f = l.lit * (0.86 + Math.sin(time * 9 + l.phase) * 0.05 + Math.sin(time * 23 + l.phase * 3) * 0.04);
      l.lp.glow.material.opacity = f * (l.small ? 0.8 : 0.95); l.lp.head.material.color.setRGB(1 * f + 0.05, 0.75 * f + 0.04, 0.45 * f + 0.04); l.flick = f;
    }
    const cand = lanterns.filter(l => l.lit > 0 && l.s > ps - 14 && l.s < ps + 60).sort((a, b) => Math.abs(a.s - ps - 8) - Math.abs(b.s - ps - 8));
    lights.forEach((li, i) => { const l = cand[i]; if (l) { li.position.copy(l.lp.g.position); li.intensity = (l.small ? 4 : 9) * l.flick; li.distance = l.small ? 6 : 13; } else li.intensity = 0; });
    for (const k in P) P[k].flush();
  }
  // cover within reach: ahead up to 5 m, behind up to 2.5 m, and not across the trail
  function coverNear(ps, u) {
    let best = null, bd = 1e9;
    for (const sp of spots) {
      const ds = sp.s - ps; if (ds > 5.2 || ds < -2.6) continue;
      const du = Math.abs(sp.objU - u); if (du > sp.halfW + 1.9 + (SPOT[sp.kind].obj - 1.4)) continue;
      const d = Math.abs(ds) + du * 0.5; if (d < bd) { bd = d; best = sp; }
    }
    return best;
  }
  function showRing(sp, a, time) {
    ringMat.opacity = a * (0.32 + Math.sin(time * 3) * 0.08);
    if (sp) { const p = place(sp.s, sp.hideU - Math.sign(sp.hideU) * (sp.inside ? 0 : 0.2)); ring.position.set(p.x, p.y + 0.04, p.z); }
  }
  function extinguishAhead(ps) { const l = lanterns.find(l => l.lit === 1 && !l.small && l.s > ps + 12 && l.s < ps + 40); if (l) { l.dying = 0.9; return l; } return null; }
  function setPalette(fog) { for (const m of lineMats) m.color.copy(fog).multiplyScalar(0.55); mistMat.uniforms.color.value.copy(fog).lerp(_c.set('#a7b0de'), 0.55); }
  const warm = on => { fallMesh.visible = on; for (const l of lampPool) l.g.visible = on || l.used; };
  return {
    reset, update, warm, coverNear, showRing, extinguishAhead, spawnFaller, setPalette, place, mistMat, beamMat,
    get spots() { return spots; }, get obstacles() { return obstacles; }, get lanterns() { return lanterns; }, get fallers() { return fallers; }, L
  };
}

// ---- 04_audio.js ----
// Procedural sound: forest bed, the wanderer's body, and the follower placed in space.
function createAudio(enabled) {
  let ac = null, master, bus, lp, comp, noise, wind, windG, leafG, drone, droneG, rumbleG, rumbleO, mBreath, mBreathG, mPan, hidden = 0, vol = 0.9, ok = false;
  const AC = window.AudioContext || window.webkitAudioContext;
  function init() {
    if (ok || !enabled || !AC) return;
    try { ac = new AC(); } catch (e) { return; }
    ok = true;
    comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4; comp.connect(ac.destination);
    master = ac.createGain(); master.gain.value = vol; master.connect(comp);
    lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 16000; lp.connect(master);
    bus = ac.createGain(); bus.connect(lp);
    const len = ac.sampleRate * 2, b = ac.createBuffer(1, len, ac.sampleRate), d = b.getChannelData(0);
    let br = 0; for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; br = (br + 0.02 * w) / 1.02; d[i] = i % 2 ? w * 0.6 : br * 3.5 + w * 0.15; }
    noise = b;
    // wind through the trees
    const wn = loopNoise(); const wf = ac.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 380; wf.Q.value = 0.5;
    windG = ac.createGain(); windG.gain.value = 0.0; wn.connect(wf); wf.connect(windG); windG.connect(bus); wind = wf;
    const ln = loopNoise(); const lf = ac.createBiquadFilter(); lf.type = 'highpass'; lf.frequency.value = 3800; leafG = ac.createGain(); leafG.gain.value = 0; ln.connect(lf); lf.connect(leafG); leafG.connect(bus);
    // low drone
    droneG = ac.createGain(); droneG.gain.value = 0; const df = ac.createBiquadFilter(); df.type = 'lowpass'; df.frequency.value = 260; df.connect(droneG); droneG.connect(bus);
    drone = [55, 55.4, 82.6, 41.2].map((f, i) => { const o = ac.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f; const g = ac.createGain(); g.gain.value = i === 2 ? 0.25 : 0.35; o.connect(g); g.connect(df); o.start(); return o; });
    rumbleO = ac.createOscillator(); rumbleO.type = 'sine'; rumbleO.frequency.value = 31; rumbleG = ac.createGain(); rumbleG.gain.value = 0; rumbleO.connect(rumbleG); rumbleG.connect(master); rumbleO.start();
    // the follower's breath, placed in space
    mPan = ac.createPanner(); mPan.panningModel = 'HRTF'; mPan.distanceModel = 'inverse'; mPan.refDistance = 2.5; mPan.rolloffFactor = 1.1; mPan.connect(bus);
    const mb = loopNoise(); const mf = ac.createBiquadFilter(); mf.type = 'bandpass'; mf.frequency.value = 340; mf.Q.value = 2.5; mBreathG = ac.createGain(); mBreathG.gain.value = 0; mb.connect(mf); mf.connect(mBreathG);
    const growl = ac.createOscillator(); growl.type = 'sawtooth'; growl.frequency.value = 62; const gf = ac.createBiquadFilter(); gf.type = 'lowpass'; gf.frequency.value = 180; const gg = ac.createGain(); gg.gain.value = 0.25; growl.connect(gf); gf.connect(gg); gg.connect(mBreathG); growl.start();
    mBreathG.connect(mPan); mBreath = mf;
  }
  function loopNoise() { const s = ac.createBufferSource(); s.buffer = noise; s.loop = true; s.loopStart = Math.random(); s.start(0, Math.random() * 1.5); return s; }
  function burst(t, dur, f0, type, q, gain, dest, f1) {
    const s = ac.createBufferSource(); s.buffer = noise; const f = ac.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.setValueAtTime(f0, t); if (f1) f.frequency.exponentialRampToValueAtTime(f1, t + dur); f.Q.value = q || 0.7;
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + Math.min(0.02, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(dest || bus); s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }
  function tone(t, dur, f0, f1, type, gain, dest, attack) {
    const o = ac.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + (attack || 0.01)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(dest || bus); o.start(t); o.stop(t + dur + 0.05);
  }
  function panned(x) { const p = ac.createStereoPanner ? ac.createStereoPanner() : null; if (!p) return bus; p.pan.value = clamp(x, -1, 1); p.connect(bus); return p; }
  const api = {
    unlock() { init(); if (ac && ac.state === 'suspended') ac.resume().catch(() => { }); },
    suspend() { if (ac && ac.state === 'running') ac.suspend().catch(() => { }); },
    resume() { if (ac && ac.state === 'suspended') ac.resume().catch(() => { }); },
    close() { try { if (ac) ac.close(); } catch (e) { } },
    get ready() { return ok && ac.state === 'running'; },
    // continuous mix: danger 0..1, hide 0..1, stage 0..3, ambient on/off
    mix(k) {
      if (!ok) return; const t = ac.currentTime;
      hidden = k.hide;
      windG.gain.setTargetAtTime((0.11 + k.gust * 0.12) * (1 - k.hide * 0.55) * k.amb, t, 0.4);
      wind.frequency.setTargetAtTime(300 + k.gust * 420, t, 0.6);
      leafG.gain.setTargetAtTime((0.012 + k.gust * 0.03) * (1 - k.hide * 0.6) * k.amb, t, 0.4);
      droneG.gain.setTargetAtTime((0.035 + k.stage * 0.012 + k.danger * 0.06) * k.amb, t, 1.2);
      drone[0].detune.setTargetAtTime(k.danger * -40, t, 1); drone[1].detune.setTargetAtTime(18 + k.danger * 30, t, 1);
      rumbleG.gain.setTargetAtTime(k.danger * k.danger * 0.22 * k.amb, t, 0.5);
      lp.frequency.setTargetAtTime(k.hide > 0.5 ? 2400 : k.over ? 900 : 16000, t, 0.35);
      mBreathG.gain.setTargetAtTime(k.mVol * 0.5, t, 0.25);
      mBreath.frequency.setTargetAtTime(260 + Math.sin(t * 1.7) * 80 + k.mVol * 60, t, 0.1);
    },
    listener(px, py, pz, fx, fz) {
      if (!ok) return; const L = ac.listener, t = ac.currentTime;
      if (L.positionX) { L.positionX.setTargetAtTime(px, t, 0.05); L.positionY.setTargetAtTime(py, t, 0.05); L.positionZ.setTargetAtTime(pz, t, 0.05); L.forwardX.setTargetAtTime(fx, t, 0.05); L.forwardY.setTargetAtTime(0, t, 0.05); L.forwardZ.setTargetAtTime(fz, t, 0.05); L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0; }
      else if (L.setPosition) { L.setPosition(px, py, pz); L.setOrientation(fx, 0, fz, 0, 1, 0); }
    },
    follower(x, y, z) { if (!ok) return; if (mPan.positionX) { const t = ac.currentTime; mPan.positionX.setTargetAtTime(x, t, 0.05); mPan.positionY.setTargetAtTime(y, t, 0.05); mPan.positionZ.setTargetAtTime(z, t, 0.05); } else mPan.setPosition(x, y, z); },
    // ---- one-shots ----
    step(heavy) { if (!ok) return; const t = ac.currentTime; burst(t, 0.07, 700 + Math.random() * 300, 'lowpass', 0.8, 0.22 * (heavy ? 1.3 : 1)); burst(t + 0.005, 0.05, 3200 + Math.random() * 2000, 'bandpass', 1.2, 0.05); },
    cloth() { if (!ok) return; burst(ac.currentTime, 0.16, 1800, 'bandpass', 0.6, 0.025); },
    breath(level, inhale) { if (!ok) return; const t = ac.currentTime; burst(t, inhale ? 0.38 : 0.3, inhale ? 1500 : 900, 'bandpass', 1.4, 0.03 + level * 0.09, null, inhale ? 2100 : 650); },
    heart(level) { if (!ok) return; const t = ac.currentTime; tone(t, 0.16, 62, 40, 'sine', 0.25 + level * 0.4, master); tone(t + 0.19, 0.14, 55, 38, 'sine', 0.16 + level * 0.3, master); },
    mStep(gain) { if (!ok) return; const t = ac.currentTime; tone(t, 0.32, 70, 32, 'sine', 0.5 * gain, mPan); burst(t, 0.18, 260, 'lowpass', 1, 0.5 * gain, mPan); burst(t + 0.02, 0.09, 2200, 'bandpass', 2, 0.12 * gain, mPan); },
    owl() { if (!ok) return; const t = ac.currentTime, d = panned(Math.random() * 2 - 1); const f = 380 + Math.random() * 60; tone(t, 0.32, f, f * 0.92, 'sine', 0.045, d, 0.06); tone(t + 0.42, 0.22, f * 1.02, f * 0.9, 'sine', 0.03, d, 0.05); tone(t + 0.7, 0.55, f, f * 0.86, 'sine', 0.04, d, 0.08); },
    creak(gain) { if (!ok) return; const t = ac.currentTime, d = panned(Math.random() * 2 - 1); const f = 90 + Math.random() * 60; const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * (0.7 + Math.random() * 0.6), t + 0.7); const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 6; const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.05 * (gain || 1), t + 0.15); g.gain.linearRampToValueAtTime(0.0001, t + 0.8); o.connect(bp); bp.connect(g); g.connect(d); o.start(t); o.stop(t + 0.85); },
    crash() { if (!ok) return; const t = ac.currentTime; burst(t, 1.4, 600, 'lowpass', 0.6, 0.6, null, 120); tone(t, 0.8, 48, 30, 'sine', 0.6, master); burst(t + 0.05, 0.6, 2500, 'bandpass', 0.8, 0.12, null, 600); },
    bats() { if (!ok) return; const t = ac.currentTime; for (let i = 0; i < 26; i++) burst(t + i * 0.045 + Math.random() * 0.02, 0.04, 2600 + Math.random() * 1500, 'bandpass', 3, 0.035, panned(-1 + i / 13)); tone(t + 0.2, 0.08, 7200, 6800, 'sine', 0.01); tone(t + 0.5, 0.08, 7600, 7000, 'sine', 0.008); },
    hiss() { if (!ok) return; burst(ac.currentTime, 0.5, 4000, 'highpass', 0.7, 0.06); },
    snap() { if (!ok) return; const t = ac.currentTime; burst(t, 0.06, 2600, 'bandpass', 2, 0.2); burst(t + 0.03, 0.18, 500, 'lowpass', 1, 0.2); },
    stumble() { if (!ok) return; const t = ac.currentTime; burst(t, 0.25, 500, 'lowpass', 0.7, 0.4); burst(t, 0.3, 3000, 'bandpass', 0.9, 0.12, null, 900); tone(t, 0.15, 90, 50, 'sine', 0.3, master); },
    hideRustle() { if (!ok) return; const t = ac.currentTime; burst(t, 0.45, 2400, 'bandpass', 0.7, 0.09, null, 900); burst(t + 0.1, 0.2, 600, 'lowpass', 1, 0.12); },
    whisper() { if (!ok) return; const t = ac.currentTime, d = panned(Math.random() < 0.5 ? -0.8 : 0.8); for (let i = 0; i < 3; i++) burst(t + i * 0.22, 0.25, 2200 + Math.random() * 1500, 'bandpass', 6, 0.035, d); },
    stage() { if (!ok) return; const t = ac.currentTime; tone(t, 4, 110, 104, 'sine', 0.05, bus, 1.2); tone(t, 4, 164.8, 160, 'sine', 0.035, bus, 1.4); tone(t + 0.3, 3.6, 233, 228, 'triangle', 0.015, bus, 1.5); },
    sting() { if (!ok) return; const t = ac.currentTime; for (const f of [58, 61.7, 87, 123.5]) tone(t, 2.6, f, f * 0.82, 'sawtooth', 0.09, master, 0.04); burst(t, 1.8, 1800, 'bandpass', 0.5, 0.45, master, 200); tone(t, 1.5, 36, 24, 'sine', 0.8, master); },
    setVolume(v) { vol = v; if (ok) master.gain.setTargetAtTime(v, ac.currentTime, 0.1); }
  };
  return api;
}

// ---- 05_ui.js ----
// Interface: restrained type, small marks, muted colour.
const SAVE_KEY = 'dlb_save_v1';
const defaultSave = () => ({ best: 0, runs: 0, tut: 0 });
const UI_CSS = `
.dl{position:absolute;inset:0;font-family:'Nunito Sans',system-ui,sans-serif;color:#dfe4f4;user-select:none;-webkit-user-select:none;overflow:hidden;pointer-events:none;--moon:#dfe4f4;--amber:#ffb766;--dim:rgba(223,228,244,.55);--ink:#07080f}
.dl *{box-sizing:border-box}
.dl-vig{position:absolute;inset:0;background:radial-gradient(ellipse 75% 62% at 50% 46%,rgba(4,5,12,0) 38%,rgba(4,5,12,.55) 78%,rgba(2,2,6,.92) 100%);transition:opacity .25s}
.dl-danger{position:absolute;inset:0;opacity:0;background:radial-gradient(ellipse 70% 58% at 50% 48%,rgba(10,4,14,0) 30%,rgba(14,5,18,.75) 80%,rgba(4,1,6,.98) 100%)}
.dl-grain{position:absolute;inset:-50%;opacity:.07;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='160' height='160' filter='url(%23n)'/></svg>");animation:dlg 1s steps(6) infinite}
@keyframes dlg{0%{transform:translate(0,0)}20%{transform:translate(-6%,4%)}40%{transform:translate(5%,-7%)}60%{transform:translate(-3%,8%)}80%{transform:translate(7%,2%)}100%{transform:translate(0,0)}}
.dl-top{position:absolute;left:0;right:0;top:0;display:flex;justify-content:space-between;align-items:flex-start;padding:16px;transition:opacity .6s}
.dl-dist{font:400 34px/1 'DM Serif Display',Georgia,serif;letter-spacing:.01em;text-shadow:0 2px 14px rgba(0,0,0,.7)}
.dl-dist small{font-size:15px;margin-left:3px;opacity:.6}
.dl-best{margin-top:6px;font:700 10px 'Nunito Sans',system-ui,sans-serif;letter-spacing:.26em;color:var(--dim)}
.dl-pause{pointer-events:auto;width:40px;height:40px;border-radius:50%;border:1px solid rgba(223,228,244,.32);background:rgba(7,8,15,.25);display:flex;align-items:center;justify-content:center;cursor:pointer;touch-action:none}
.dl-pause svg{width:14px;height:14px}
.dl-bottom{position:absolute;left:0;right:0;bottom:0;display:flex;flex-direction:column;align-items:center;padding-bottom:28px;transition:opacity .6s}
.dl-ctx{height:20px;margin-bottom:12px;font:700 12px/20px 'Nunito Sans',system-ui,sans-serif;letter-spacing:.46em;padding-left:.46em;opacity:0;transition:opacity .25s,color .25s;text-shadow:0 0 14px rgba(0,0,0,.9)}
.dl-ctx.hide{color:var(--amber);text-shadow:0 0 16px rgba(255,170,90,.45)}
.dl-ctx.ex{color:#c99aa6}
.dl-ctx.run{color:var(--moon)}
.dl-bar{position:relative;width:min(48vw,230px);height:3px;border-radius:2px;background:rgba(223,228,244,.13);overflow:hidden}
.dl-bar b{position:absolute;left:0;top:0;bottom:0;width:100%;background:var(--moon);transform-origin:0 50%;border-radius:2px;transition:background .3s}
.dl-bar.low b{background:#e2ac72}
.dl-bar.ex b{background:#a87a88;animation:dlp .6s ease-in-out infinite alternate}
@keyframes dlp{from{opacity:.35}to{opacity:1}}
.dl-barl{margin-top:8px;font:700 9px 'Nunito Sans',sans-serif;letter-spacing:.32em;color:rgba(223,228,244,.38)}
.dl-stage{position:absolute;left:0;right:0;top:24%;text-align:center;font:italic 400 24px 'DM Serif Display',Georgia,serif;letter-spacing:.06em;opacity:0;transition:opacity 1.6s;text-shadow:0 2px 20px rgba(0,0,0,.9)}
.dl-stage small{display:block;margin-bottom:8px;font:700 9px 'Nunito Sans',sans-serif;letter-spacing:.4em;font-style:normal;color:var(--dim)}
.dl-hint{position:absolute;right:16px;bottom:96px;width:132px;display:flex;flex-direction:column;align-items:center;opacity:0;transition:opacity .5s}
.dl-hint i{width:54px;height:54px;border-radius:50%;border:1.5px solid rgba(223,228,244,.7);animation:dlr 1.6s ease-out infinite}
@keyframes dlr{0%{transform:scale(.7);opacity:.9}100%{transform:scale(1.25);opacity:0}}
.dl-hint span{margin-top:12px;font:700 10px/1.6 'Nunito Sans',sans-serif;letter-spacing:.26em;text-align:center;color:var(--moon);text-shadow:0 0 10px #000}
.dl-hint.c{left:0;right:0;width:auto;bottom:130px}
.dl-hint.c i{display:none}
.dl-fade{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .6s}
.dl-eyes{position:absolute;left:50%;top:22%;transform:translate(-50%,-50%);display:flex;gap:26px;opacity:0;transition:opacity 1.2s}
.dl-eyes b{width:7px;height:5px;border-radius:50%;background:#ffd59c;box-shadow:0 0 10px 3px rgba(255,170,80,.75),0 0 40px 10px rgba(255,140,60,.25)}
.dl-eyes b:last-child{transform:translateY(-2px)}
.dl-title{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:space-between;text-align:center;padding:16px;transition:opacity .9s}
.dl-title.off{opacity:0}
.dl-logo{margin-top:15vh;font:400 44px/1 'DM Serif Display',Georgia,serif;letter-spacing:.08em;text-shadow:0 4px 30px rgba(0,0,0,.9)}
.dl-logo span{display:block;font-size:.5em;letter-spacing:.42em;margin-bottom:10px;padding-left:.42em;color:var(--dim)}
.dl-sub{margin-top:14px;font:italic 400 17px 'DM Serif Display',Georgia,serif;color:rgba(223,228,244,.72);letter-spacing:.03em}
.dl-tap{font:700 11px 'Nunito Sans',sans-serif;letter-spacing:.5em;padding-left:.5em;animation:dlp 1.4s ease-in-out infinite alternate}
.dl-foot{margin-bottom:28px;display:flex;flex-direction:column;align-items:center;gap:18px}
.dl-tb{font:700 10px 'Nunito Sans',sans-serif;letter-spacing:.3em;color:var(--dim)}
.dl-panel{position:absolute;inset:0;display:none;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:16px;pointer-events:auto}
.dl-panel.on{display:flex}
.dl-panel.pz{background:rgba(5,6,14,.72);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.dl-h{font:400 30px/1.1 'DM Serif Display',Georgia,serif;letter-spacing:.04em;margin-bottom:22px}
.dl-stats{font:700 11px/2.1 'Nunito Sans',sans-serif;letter-spacing:.3em;color:var(--dim)}
.dl-stats b{color:var(--moon);font-weight:700}
.dl-new{margin-top:6px;font:700 10px 'Nunito Sans',sans-serif;letter-spacing:.34em;color:var(--amber);min-height:14px}
.dl-btns{margin-top:30px;display:flex;flex-direction:column;gap:10px;width:min(72vw,260px)}
.dl-b{pointer-events:auto;cursor:pointer;border:1px solid rgba(223,228,244,.35);background:rgba(223,228,244,.04);color:var(--moon);border-radius:2px;padding:14px 10px;font:700 11px 'Nunito Sans',sans-serif;letter-spacing:.34em;touch-action:manipulation}
.dl-b.pri{background:var(--moon);color:var(--ink);border-color:var(--moon)}
.dl-over{opacity:0;transition:opacity .8s}
.dl-over.show{opacity:1}
.dl-err{position:absolute;left:16px;right:16px;bottom:30%;text-align:center;font:400 16px/1.5 'DM Serif Display',Georgia,serif}
`;
const ICON_PAUSE = '<svg viewBox="-10 -10 20 20"><path d="M-3.5,-6V6M3.5,-6V6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

// ---- 06_game.js ----
// The game: run or hide, the pursuit, the camera, events and screens.
window.plethoraBit = {
  meta: { title: "DON'T LOOK BACK", runtime: 'plethora-bit@2', tags: ['arcade', 'horror', '3d', 'endless', 'runner'], permissions: ['haptics', 'audio', 'storage'] },

  async init(ctx) {
    const caps = ctx.capabilities || {};
    let destroyed = false;
    let save = defaultSave();
    try { const s = caps.storage && ctx.storage ? ctx.storage.get(SAVE_KEY) : null; if (s && typeof s === 'object') save = Object.assign(defaultSave(), s); } catch (e) { }
    const persist = () => { try { if (caps.storage && ctx.storage) ctx.storage.set(SAVE_KEY, save); } catch (e) { } };
    const haptic = k => { try { if (caps.haptics) ctx.platform.haptic(k); } catch (e) { } };

    // ---------- DOM shell, drawn before the engine loads ----------
    const canvas = ctx.createCanvas({ touchAction: 'none', layer: 'content' });
    canvas.style.cssText += ';width:100%;height:100%;display:block;background:radial-gradient(ellipse at 50% 70%,#1b2342,#05060e 80%)';
    const ui = ctx.createRoot({ className: 'dl', layer: 'overlay', input: 'passthrough' });
    const st = document.createElement('style'); st.textContent = UI_CSS; ui.appendChild(st);
    const el = (tag, cls, html, parent) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; (parent || ui).appendChild(e); return e; };
    const H = {};
    H.vig = el('div', 'dl-vig'); H.danger = el('div', 'dl-danger'); el('div', 'dl-grain');
    H.top = el('div', 'dl-top');
    const tl = el('div', '', '', H.top); H.dist = el('div', 'dl-dist', '0<small>m</small>', tl); H.best = el('div', 'dl-best', '', tl);
    H.pause = el('div', 'dl-pause', ICON_PAUSE, H.top);
    H.bottom = el('div', 'dl-bottom'); H.ctx = el('div', 'dl-ctx', '', H.bottom); H.bar = el('div', 'dl-bar', '<b></b>', H.bottom); H.barFill = H.bar.firstChild; el('div', 'dl-barl', 'BREATH', H.bottom);
    H.stage = el('div', 'dl-stage');
    H.hint = el('div', 'dl-hint', '<i></i><span></span>'); H.hintT = H.hint.lastChild;
    H.title = el('div', 'dl-title');
    const lg = el('div', '', '', H.title); el('div', 'dl-logo', "<span>DON'T</span>LOOK BACK", lg); el('div', 'dl-sub', 'Something is following you.', lg);
    const ft = el('div', 'dl-foot', '', H.title); H.tap = el('div', 'dl-tap', 'LOADING', ft); H.tbest = el('div', 'dl-tb', '', ft);
    H.fade = el('div', 'dl-fade'); H.eyes = el('div', 'dl-eyes', '<b></b><b></b>');
    H.over = el('div', 'dl-panel dl-over');
    el('div', 'dl-h', "YOU DIDN'T MAKE IT.", H.over); H.ostats = el('div', 'dl-stats', '', H.over); H.onew = el('div', 'dl-new', '', H.over);
    const ob = el('div', 'dl-btns', '', H.over); H.again = el('button', 'dl-b pri', 'TRY AGAIN', ob); H.menu = el('button', 'dl-b', 'MAIN MENU', ob);
    H.paused = el('div', 'dl-panel pz'); el('div', 'dl-h', 'Paused', H.paused); H.pstats = el('div', 'dl-stats', '', H.paused);
    const pb = el('div', 'dl-btns', '', H.paused); H.resume = el('button', 'dl-b pri', 'RESUME', pb); H.pmenu = el('button', 'dl-b', 'MAIN MENU', pb);
    const setHud = on => { H.top.style.opacity = on ? 1 : 0; H.bottom.style.opacity = on ? 1 : 0; H.pause.style.pointerEvents = on ? 'auto' : 'none'; };
    setHud(false);
    if (save.best > 0) H.tbest.textContent = 'PERSONAL BEST  ' + save.best + ' M';
    if (ctx.markVisualReady) ctx.markVisualReady('title');
    try { ctx.loadFont('DM Serif Display', 'dm-serif-display', '1.0.0', { weight: '400', style: 'normal' }).catch(() => { }); } catch (e) { }
    try { ctx.loadFont('Nunito Sans', 'nunito-sans', '1.0.0', { weight: '700', style: 'normal' }).catch(() => { }); } catch (e) { }

    function bootFail(stage, err) {
      try { ctx.platform.error({ stage, message: String((err && err.message) || err) }); } catch (e) { }
      const msg = { library: 'The forest could not be downloaded. Check your connection and reopen.', renderer: 'This device could not start 3D graphics (WebGL).', frame: 'The first frame failed to draw. Please reopen.' }[stage];
      H.tap.style.display = 'none'; el('div', 'dl-err', msg);
      try { ctx.platform.ready(); } catch (e) { }
    }
    let THREE;
    try { THREE = await ctx.importModule('three', '0.164.1'); } catch (e) { bootFail('library', e); return; }
    if (destroyed) return;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { bootFail('renderer', e); return; }
    const small = Math.min(ctx.width, ctx.height) < 600;
    renderer.setPixelRatio(Math.min(ctx.nativeDpr || ctx.dpr || 1, small ? 1.6 : 1.5));
    renderer.setSize(ctx.width, ctx.height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    ctx.onDestroy(() => { destroyed = true; try { renderer.dispose(); } catch (e) { } });

    // ---------- scene ----------
    // hidden scratch canvases for the procedural textures
    const A = createAssets(THREE, () => { const c = ctx.createCanvas2D({ layer: 'background', input: 'passthrough' }); c.style.display = 'none'; return c; });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(62, ctx.width / ctx.height, 0.1, 320);
    scene.add(camera);
    const MOON = new THREE.Vector3(0.32, 0.36, 1).normalize();
    const skyMat = new THREE.ShaderMaterial({
      uniforms: { horizon: { value: new THREE.Color('#1b2342') }, zenith: { value: new THREE.Color('#070a1a') }, glow: { value: new THREE.Color('#2c3766') }, moon: { value: MOON.clone() } },
      vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }',
      fragmentShader: `uniform vec3 horizon, zenith, glow, moon; varying vec3 vDir;
        float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        void main(){ vec3 d = normalize(vDir); float y = clamp(d.y, 0., 1.);
          vec3 c = mix(horizon, zenith, pow(y, .55));
          float m = max(dot(d, moon), 0.);
          c += glow * (pow(m, 4.) * .9 + pow(m, 30.) * .9);
          c = mix(c, vec3(.86,.89,1.), smoothstep(.99935, .99965, m));
          vec3 q = floor(d * 220.); float st = step(.9965, h(q)) * smoothstep(.05, .35, y) * .55;
          c += vec3(st) * (.6 + .4 * sin(h(q + 1.) * 40.));
          gl_FragColor = vec4(c, 1.); }`,
      side: THREE.BackSide, depthWrite: false, fog: false
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), skyMat); sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
    scene.fog = new THREE.Fog('#1b2342', 16, 98);
    const hemi = new THREE.HemisphereLight('#5d6cb0', '#1a1830', 0.8); scene.add(hemi);
    const moon = new THREE.DirectionalLight('#b9c6ff', 1.7);
    moon.castShadow = true; moon.shadow.mapSize.set(small ? 1024 : 2048, small ? 1024 : 2048);
    Object.assign(moon.shadow.camera, { left: -26, right: 26, top: 30, bottom: -24, near: 1, far: 140 });
    moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.05;
    scene.add(moon); scene.add(moon.target);
    const rim = new THREE.PointLight('#93a6ff', 1.6, 7, 1.4); scene.add(rim);

    const W = createWorld(THREE, A, scene, small);
    const R = createRigs(THREE, A);
    const hero = R.makeWanderer(); scene.add(hero.root);
    hero.root.traverse(o => { if (o.isMesh) o.receiveShadow = false; });
    const beast = R.makeFollower({ seed: 9 }); scene.add(beast.root);
    const eyeLight = new THREE.PointLight('#ffad5c', 0, 8, 1.5); eyeLight.position.set(0, 0.2, -1.4); beast.head.add(eyeLight);
    // eye glows keep a minimum size on screen so a pair of eyes reads even far down the trail
    const eyeScale = (rig, k) => { const d = camera.position.distanceTo(rig.root.position); for (let i = 1; i < rig.eyes.length; i += 2) rig.eyes[i].scale.setScalar(Math.max(0.42, d * k)); };
    const phantom = R.makeFollower({ seed: 23, eye: '#e7e4ff' }); scene.add(phantom.root); phantom.root.visible = false;
    phantom.skin.transparent = true;
    // a pair of eyes alone between the trees
    const eyePair = new THREE.Group(); scene.add(eyePair); eyePair.visible = false;
    const eyeGlow = new THREE.SpriteMaterial({ map: A.T.glow, color: '#ffbf70', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (const s of [-1, 1]) { const g = new THREE.Sprite(eyeGlow); g.scale.set(0.5, 0.36, 1); g.position.set(s * 0.16, s > 0 ? 0.03 : 0, 0); eyePair.add(g); }
    // bats
    const batGeo = A.merge([{ geo: new THREE.SphereGeometry(0.07, 5, 4), color: '#0a090f' }, { geo: new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.05, 0.42, 0.08, 0.05, 0.06, 0, 0.08, 0, 0, -0.05, -0.06, 0, 0.08, -0.42, 0.08, 0.05]), 3)), color: '#0d0b14' }]);
    const bats = new THREE.InstancedMesh(batGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }), 16); bats.frustumCulled = false; bats.visible = false; scene.add(bats);
    const batState = { t: -1, list: [] };
    // drifting motes near the lens
    const motes = (() => {
      const n = small ? 220 : 340, g = new THREE.BufferGeometry(), p = new Float32Array(n * 3), r = makeRng(3);
      for (let i = 0; i < n * 3; i += 3) { p[i] = (r() - 0.5) * 30; p[i + 1] = r() * 9; p[i + 2] = (r() - 0.5) * 40; }
      g.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const m = new THREE.Points(g, new THREE.PointsMaterial({ color: '#aab6ee', size: 0.06, map: A.T.glow, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.frustumCulled = false; scene.add(m); return { m, base: p.slice(), n };
    })();

    const audio = createAudio(!!caps.audio);
    ctx.onDestroy(() => audio.close());
    const scoreTrack = ctx.game && ctx.game.score ? ctx.game.score() : null;

    // ---------- state ----------
    let mode = 'title', run = null, time = 0, hintStep = 0, title = true, safeBot = 0;
    const HP = new THREE.Vector3(), FP = new THREE.Vector3(), HEAD = new THREE.Vector3();
    const input = { hold: false, ptr: null, keys: new Set() };
    const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), dpos: new THREE.Vector3(), dlook: new THREE.Vector3(), init: false, swing: 0, shake: 0, roll: 0, fov: 62 };
    const _a = { x: 0, z: 0 }, _b = { x: 0, z: 0 }, _v = new THREE.Vector3(), _w = new THREE.Vector3(), _c = new THREE.Color(), _c2 = new THREE.Color();
    const fogCols = STAGES.map(s => new THREE.Color(s.fog)), skyCols = STAGES.map(s => new THREE.Color(s.sky)), zenCols = STAGES.map(s => new THREE.Color(s.zen));
    const at = (s, u, y, out) => { trailPoint(s, u, _a); (out || _v).set(_a.x, groundY(_a.x, _a.z) + (y || 0), _a.z); return out || _v; };

    function newRun() {
      const seed = (Math.random() * 1e9) | 0;
      W.reset(seed);
      run = {
        s: 0, u: 0, uT: 0, v: 0, y: 0, stamina: 100, exhausted: false, state: 'stop', spot: null, hideT: 0, tripT: 0, vaultT: 0, time: 0, heat: 0,
        from: null, moveT: 0, stage: 0, best: save.best, fogSurge: 0, ev: { next: 9, owl: 4, creak: 7, whisper: 20 }, apparition: null, catchT: 0, over: false,
        stepSign: 1, mStepSign: 1, breathT: 0, heartT: 0, inhale: false, ctxMsg: '', danger: 0, warnedSearch: false,
        M: { mode: 'stalk', gap: 36, lat: 0, speed: 0, timer: 0, spotted: false, lostT: 0, exit: 1, vs: -36, vu: 0, seen: 0 }
      };
      W.update(0, 0, time, camera);
      cam.init = false;
    }

    // ---------- the pursuit ----------
    const runSpeed = d => 7.4 + 3.2 * d;
    const hideWindow = d => lerp(7.8, 5.0, d);
    const breathNeed = d => 30 + 25 * d;
    function startHide(sp) {
      const r = run;
      r.state = 'toHide'; r.spot = sp; r.hideT = 0; r.moveT = 0; r.y = 0; r.from = { s: r.s, u: r.u };
      // seen going into cover: it will come straight to it
      r.M.spotted = r.M.mode === 'stalk' && r.M.gap < 5.5;
      audio.hideRustle(); haptic('light');
      if (hintStep === 3) { hintStep = 4; showHint('WAIT FOR IT TO PASS', 3.5, true); }
    }
    function leaveHide() {
      const r = run, M = r.M, sp = r.spot;
      r.state = 'leave'; r.moveT = 0; r.from = { s: r.s, u: r.u }; r.uT = sp.side * (sp.halfW - 0.7);
      audio.hideRustle();
      if (M.mode === 'pass') {
        const d = Math.abs(M.gap);
        if (d < 4.5) { catchPlayer('seen'); return; }
        if (d < 12) { M.mode = 'stalk'; M.gap = 7; r.heat = 1; haptic('warning'); }
        else loseTrail();
      } else if (M.mode === 'search') { M.mode = 'stalk'; M.gap = 6.5; r.heat = 1; haptic('warning'); }
      M.spotted = false;
    }
    // it has gone past and wanders off the trail for a while
    function loseTrail() {
      const r = run, M = r.M;
      M.mode = 'lost'; M.timer = lerp(7, 3, difficultyAt(r.s)) + Math.random() * 2; M.lostT = 0;
      M.exit = r.spot ? -r.spot.side : (Math.random() < 0.5 ? -1 : 1);
    }
    function catchPlayer(reason) {
      const r = run; if (r.over) return;
      r.state = 'caught'; r.M.mode = 'catch'; r.catchT = 0; r.reason = reason;
      audio.sting(); haptic('heavy');
      mode = 'caught';
      endRun();
    }
    function trip(o) {
      const r = run;
      r.state = 'trip'; r.tripT = o.kind === 'bridge' ? 1.0 : 0.72; r.v *= 0.18; r.stamina = Math.max(0, r.stamina - 8); r.heat = Math.min(1, r.heat + 0.25);
      if (o.kind === 'bridge') r.dip = 1;
      audio.stumble(); haptic('medium');
      for (const b of o.blocks) if (r.u > b[0] - 0.3 && r.u < b[1] + 0.3 && b[0] > -50 && b[1] < 50) { const left = b[0] - 0.35, right = b[1] + 0.35; r.uT = Math.abs(r.u - left) < Math.abs(r.u - right) ? left : right; }
    }

    function step(dt) {
      const r = run, M = r.M;
      if (r.over && r.state !== 'caught') return;
      r.time += dt;
      const d = difficultyAt(r.s), halfW = stageParam(r.s, 'halfW'), lim = halfW - 0.3;
      const intro = clamp(r.time / 15, 0.35, 1);
      const prevS = r.s;
      // ---- the wanderer ----
      switch (r.state) {
        case 'stop': case 'run': case 'vault': {
          if (input.hold) { if (r.state === 'stop') r.state = 'run'; }
          else { const sp = W.coverNear(r.s, r.u); if (sp) { startHide(sp); break; } r.state = 'stop'; }
          const target = r.state === 'stop' ? 0 : runSpeed(d) * (r.exhausted ? 0.6 : 1);
          r.v = target > r.v ? Math.min(target, r.v + 15 * dt) : Math.max(target, r.v - 20 * dt);
          r.s += r.v * dt;
          if (r.v > 0.3) r.u = damp(r.u, r.uT, 9, dt);
          if (r.state === 'vault') { r.vaultT -= dt; r.y = Math.sin(Math.PI * clamp(1 - r.vaultT / 0.44, 0, 1)) * 0.6; if (r.vaultT <= 0) { r.y = 0; r.state = input.hold ? 'run' : 'stop'; } }
          if (r.state === 'stop') r.stamina += (r.v < 1 ? 11 : 0) * dt;
          else r.stamina -= (9.2 + 3.2 * d) * dt * (r.exhausted ? 0.25 : 1);
          break;
        }
        case 'trip':
          r.tripT -= dt; r.v = damp(r.v, 0, 6, dt); r.s += r.v * dt; r.u = damp(r.u, r.uT, 6, dt);
          if (r.tripT <= 0) { r.state = input.hold ? 'run' : 'stop'; r.dip = 0; }
          break;
        case 'toHide': {
          r.moveT += dt / 0.4; const t = smooth(r.moveT);
          r.s = lerp(r.from.s, r.spot.s, t); r.u = lerp(r.from.u, r.spot.hideU, t); r.v = 0; r.uT = r.u;
          r.stamina += 12 * dt;
          if (r.moveT >= 1) r.state = 'hide';
          break;
        }
        case 'hide':
          // breath comes back slowly while it is close: you are holding it
          r.hideT += dt; r.stamina += (M.mode === 'pass' || (M.mode === 'stalk' && M.gap < 8) ? 4 : 17) * dt;
          if (input.hold) leaveHide();
          break;
        case 'leave': {
          r.moveT += dt / 0.3; const t = smooth(r.moveT);
          r.u = lerp(r.from.u, r.uT, t); r.v = Math.min(runSpeed(d), r.v + 12 * dt); r.s += r.v * dt * t;
          if (r.moveT >= 1) r.state = input.hold ? 'run' : 'stop';
          break;
        }
        case 'caught': r.catchT += dt; r.v = 0; break;
      }
      if (r.state === 'caught') { stepCatch(dt); return; }
      r.u = clamp(r.u, r.state === 'hide' || r.state === 'toHide' || r.state === 'leave' ? -halfW - 5 : -lim, r.state === 'hide' || r.state === 'toHide' || r.state === 'leave' ? halfW + 5 : lim);
      r.stamina = clamp(r.stamina, 0, 100);
      if (!r.exhausted && r.stamina <= 0 && (r.state === 'run' || r.state === 'vault')) { r.exhausted = true; haptic('warning'); audio.breath(1, true); }
      if (r.exhausted && r.stamina >= 35) r.exhausted = false;
      // ---- obstacles: low ones are vaulted at speed, the rest must be steered around ----
      if (r.state === 'run' || r.state === 'vault' || r.state === 'stop' || r.state === 'leave') {
        for (const o of W.obstacles) {
          if (o.hit) continue;
          const a = o.s - o.len / 2, b = o.s + o.len / 2;
          if (r.s < a || prevS > b) continue;
          if (o.low) {
            if (prevS <= o.s && r.s > o.s) {
              o.hit = true;
              if (r.state === 'run' && r.v > 4.6 && !r.exhausted) { r.state = 'vault'; r.vaultT = 0.44; r.stamina -= 3; audio.cloth(); haptic('light'); }
              else if (r.state !== 'vault') trip(o);
            }
          } else if (o.blocks.some(bk => r.u + 0.26 > bk[0] && r.u - 0.26 < bk[1])) { o.hit = true; trip(o); }
        }
      }
      // ---- heat: how much noise has been made ----
      const moving = r.state === 'run' || r.state === 'vault' || r.state === 'leave';
      const hidden = r.state === 'hide' || r.state === 'toHide';
      r.heat = clamp(r.heat + (moving ? (0.045 + 0.05 * d + (r.exhausted ? 0.1 : 0)) : hidden ? -0.16 : -0.04) * dt, 0, 1);
      // ---- the follower ----
      const pv = moving ? r.v : r.state === 'trip' ? r.v : 0;
      const win = hideWindow(d);
      switch (M.mode) {
        case 'stalk': {
          let ms;
          if (hidden) ms = (M.spotted || r.hideT > win) ? 9 + 2 * d : M.gap > 18 ? 7.6 + 2.4 * d : 3.8 + 2.4 * d;
          else if (pv > 0.5) ms = pv + (0.3 + 1.5 * d + 0.9 * r.heat + (r.exhausted ? 1.2 : 0)) * intro;
          else ms = (6 + 2 * d) * (0.6 + 0.4 * intro);
          if (M.gap > 52 && ms < pv) ms = pv;
          M.speed = ms; M.gap -= (ms - pv) * dt;
          if (!hidden && M.gap <= 1.0) catchPlayer('caught');
          else if (hidden && M.gap <= 1.7) {
            // seen going in, hidden too long, or still gasping for breath: it stops at your cover
            if (M.spotted || r.hideT > win || r.stamina < breathNeed(d)) { M.mode = 'search'; M.timer = lerp(2.4, 1.6, d); haptic('warning'); }
            else { M.mode = 'pass'; }
          }
          break;
        }
        case 'pass':
          M.speed = 2.5; M.gap -= (2.5 - pv) * dt;
          if (M.gap < -13 || !hidden) loseTrail();
          break;
        case 'search':
          M.speed = 0.5; M.timer -= dt;
          if (M.timer <= 0) catchPlayer('found');
          break;
        case 'lost':
          M.lostT += dt; M.gap -= (2.2 - pv) * dt;
          M.timer -= dt * (hidden && r.hideT > win ? 2.5 : 1);
          if (M.timer <= 0) { M.mode = 'stalk'; M.gap = lerp(46, 28, d); M.lat = 0; M.vs = r.s - M.gap; M.vu = 0; }
          break;
      }
      r.s = Math.max(r.s, prevS - 3);
      // ---- events ----
      events(dt, d);
      // ---- tutorial ----
      if (save.tut < 2) {
        if (hintStep === 0 && r.v > 2) { hintStep = 1; showHint('SLIDE TO STEER', 2.8, true); }
        if (hintStep <= 2 && hintStep >= 1 && W.coverNear(r.s, r.u) && r.state === 'run') { hintStep = 3; showHint('LET GO TO HIDE', 2.5, true); }
      }
      const si = stageIndex(r.s);
      if (si !== r.stage) { r.stage = si; showStage(si); }
    }
    function stepCatch(dt) {
      const r = run, M = r.M;
      // the follower closes the last of the distance
      M.gap = damp(M.gap, 0.9, 5, dt);
    }

    // ---------- events: apparitions, bats, lanterns, falling trees, fog ----------
    function events(dt, d) {
      const r = run, ev = r.ev, M = r.M, hidden = r.state === 'hide' || r.state === 'toHide';
      ev.owl -= dt; if (ev.owl <= 0) { audio.owl(); ev.owl = 9 + Math.random() * 14; }
      ev.creak -= dt; if (ev.creak <= 0) { audio.creak(hidden ? 1.6 : 1); ev.creak = 5 + Math.random() * 9; }
      if (r.stage >= 2) { ev.whisper -= dt; if (ev.whisper <= 0) { audio.whisper(); ev.whisper = 14 + Math.random() * 20; } }
      r.fogSurge = Math.max(0, r.fogSurge - dt / 7);
      ev.next -= dt;
      if (ev.next > 0 || r.time < 8) return;
      ev.next = lerp(14, 7, d) * (0.7 + Math.random() * 0.6);
      const st = r.stage, quiet = !hidden && (M.mode === 'lost' || M.gap > 18);
      const opts = [];
      if (quiet && !r.apparition) { opts.push(['eyes', 1 + st]); opts.push(['cross', M.mode === 'lost' ? 3 : 0.8 + st * 0.4]); if (st >= 1) opts.push(['stand', 0.8 + st * 0.5]); }
      opts.push(['bats', 1]);
      if (W.lanterns.some(l => l.lit === 1 && !l.small && l.s > r.s + 12 && l.s < r.s + 40)) opts.push(['lantern', 1.6]);
      if (st >= 1) opts.push(['fog', 0.8]);
      if (st >= 1 && !hidden && r.v > 3) opts.push(['tree', 0.9 + st * 0.2]);
      let tot = 0; for (const o of opts) tot += o[1] * stageParam(r.s, 'apparition') * (o[0] === 'bats' || o[0] === 'lantern' || o[0] === 'fog' || o[0] === 'tree' ? 1.6 : 1);
      let x = Math.random() * tot, pick = null;
      for (const o of opts) { x -= o[1] * stageParam(r.s, 'apparition') * (o[0] === 'bats' || o[0] === 'lantern' || o[0] === 'fog' || o[0] === 'tree' ? 1.6 : 1); if (x <= 0) { pick = o[0]; break; } }
      if (!pick) return;
      if (pick === 'eyes' || pick === 'cross' || pick === 'stand') {
        const side = Math.random() < 0.5 ? -1 : 1;
        r.apparition = { kind: pick, t: 0, side, s: r.s + (pick === 'cross' ? 38 : 30) + Math.random() * 12, u: side * (stageParam(r.s, 'halfW') + 7 + Math.random() * 7), dur: pick === 'cross' ? 6 : pick === 'stand' ? 4.5 : 3.2 };
        if (pick !== 'eyes') audio.creak(0.8);
      } else if (pick === 'bats') { startBats(); audio.bats(); haptic('light'); }
      else if (pick === 'lantern') { if (W.extinguishAhead(r.s)) ctx.timeout(() => audio.hiss(), 500); }
      else if (pick === 'fog') r.fogSurge = 1;
      else if (pick === 'tree') { const f = W.spawnFaller(r.s + 46 + r.v * 0.6); if (f) f.sound = false; }
    }
    function startBats() {
      const r = run, side = Math.random() < 0.5 ? -1 : 1;
      batState.t = 0; batState.list = []; bats.visible = true;
      for (let i = 0; i < 14; i++) batState.list.push({ s: r.s + 9 + Math.random() * 14, u0: side * (12 + Math.random() * 5), u1: -side * (14 + Math.random() * 6), y: 3.5 + Math.random() * 4, delay: Math.random() * 0.7, ph: Math.random() * 6, wob: Math.random() * 6 });
    }

    // ---------- presentation ----------
    let stageTimer = 0, hintTimer = 0;
    function showStage(i) {
      H.stage.innerHTML = `<small>${['I', 'II', 'III', 'IV'][i]}</small>${STAGES[i].name}`; H.stage.style.opacity = 1; stageTimer = 3.8;
      if (i > 0) { audio.stage(); try { ctx.platform.milestone('stage', { stage: i + 1, name: STAGES[i].name }); } catch (e) { } }
    }
    function showHint(text, dur, centred) { H.hint.style.bottom = ((centred ? 132 : 96) + safeBot) + 'px'; H.hintT.innerHTML = text; H.hint.classList.toggle('c', !!centred); H.hint.style.opacity = 1; hintTimer = dur; }
    function setCtx(msg, cls) { if (run.ctxMsg === msg + cls) return; run.ctxMsg = msg + cls; H.ctx.textContent = msg; H.ctx.className = 'dl-ctx ' + (cls || ''); H.ctx.style.opacity = msg ? 1 : 0; }

    const mixA = { danger: 0, hide: 0 };
    let gust = 0, gustT = 0;
    function frame(dt, skipRender) {
      time += dt;
      const r = run, M = r.M, d = difficultyAt(r.s);
      W.update(r.s, dt, time, camera);
      // ---- palette by stage, plus fog surges ----
      const sm = stageMix(r.s), j = Math.min(sm.i + 1, STAGES.length - 1);
      _c.copy(fogCols[sm.i]).lerp(fogCols[j], sm.t);
      scene.fog.color.copy(_c); skyMat.uniforms.horizon.value.copy(_c);
      skyMat.uniforms.glow.value.copy(skyCols[sm.i]).lerp(skyCols[j], sm.t);
      skyMat.uniforms.zenith.value.copy(zenCols[sm.i]).lerp(zenCols[j], sm.t);
      W.setPalette(_c);
      const surge = smooth(r.fogSurge > 0.85 ? (1 - r.fogSurge) / 0.15 : r.fogSurge);
      scene.fog.near = stageParam(r.s, 'fogNear') * (1 - surge * 0.6);
      scene.fog.far = stageParam(r.s, 'fogFar') * (1 - surge * 0.38);
      W.mistMat.uniforms.far.value = scene.fog.far; W.mistMat.uniforms.opacity.value = 0.34 + surge * 0.4 + r.stage * 0.05;
      hemi.intensity = stageParam(r.s, 'hemi'); moon.intensity = stageParam(r.s, 'moon');
      // ---- the wanderer ----
      const hp = at(r.s, r.u, 0, HP);
      let hy = hp.y + r.y;
      if (r.dip) hy -= Math.sin(clamp(1 - r.tripT / 1.0, 0, 1) * Math.PI) * 0.7;
      if (r.state === 'hide' || r.state === 'toHide') { if (r.spot.inside && r.spot.kind === 'hollowLog') hy = hp.y + 0.38 * smooth(r.state === 'hide' ? 1 : r.moveT); }
      hero.root.position.set(hp.x, hy, hp.z);
      let yaw = TRAIL.yaw(r.s) - (r.u - r.uT) * 0.15;
      if (r.state === 'toHide' || r.state === 'hide') yaw = TRAIL.yaw(r.s) + (r.spot.side > 0 ? Math.PI * 0.75 : -Math.PI * 0.75) * smooth(r.state === 'hide' ? 1 : r.moveT) * 0.55;
      if (r.state === 'caught') yaw = TRAIL.yaw(r.s);
      hero.root.rotation.y = damp(hero.root.rotation.y, yaw, 10, dt);
      const hs = r.state === 'run' || r.state === 'leave' ? 'run' : r.state === 'vault' ? 'vault' : r.state === 'trip' ? 'trip' : r.state === 'hide' || r.state === 'toHide' ? 'hide' : r.state === 'caught' ? 'caught' : (r.stamina < 70 && mode === 'play' ? 'recover' : 'idle');
      R.animateWanderer(hero, hs, r.v, dt, { exhausted: r.exhausted, look: r.state === 'caught' ? clamp(r.catchT * 2, 0, 1) * 0.9 : 0, peek: M.mode === 'pass' ? clamp(-M.gap / 10, -0.4, 0.4) : 0 });
      // ---- the follower ----
      let fs = r.s - M.gap, fu = 0;
      const halfW = stageParam(r.s, 'halfW');
      if (M.mode === 'pass') fu = r.spot ? -r.spot.side * halfW * 0.35 : 0;
      else if (M.mode === 'search') { fs = r.spot.s - 1.0; fu = r.spot.objU * 0.55 + Math.sin(time * 0.9) * 0.6; }
      else if (M.mode === 'lost') fu = M.exit * smooth(M.lostT / 2.4) * (halfW + 16);
      else if (M.mode === 'catch') { fs = r.s - Math.max(0.9, M.gap); fu = r.u; }
      else if (M.mode === 'stalk') fu = Math.sin(time * 0.37) * halfW * 0.4;
      if (title) { fs = r.s - 50; fu = 0.4; }
      const snap = Math.abs(M.vs - fs) > 30;
      M.vs = snap ? fs : damp(M.vs, fs, M.mode === 'catch' ? 9 : 3.5, dt); M.vu = snap ? fu : damp(M.vu, fu, 1.6, dt);
      const fp = at(M.vs, M.vu, 0, FP);
      beast.root.position.set(fp.x, fp.y, fp.z);
      let fyaw = TRAIL.yaw(M.vs);
      if (M.mode === 'lost') fyaw -= M.exit * 0.9 * smooth(M.lostT / 2);
      if (M.mode === 'search' || M.mode === 'catch') fyaw = Math.atan2(-(hp.x - fp.x), -(hp.z - fp.z));
      beast.root.rotation.y = damp(beast.root.rotation.y, fyaw, 4, dt);
      const visible = title || (M.mode !== 'lost' || M.lostT < 3.2) && M.gap < 75;
      beast.root.visible = visible;
      let eyes = 1;
      if (M.mode === 'stalk' && M.gap > 18) eyes = 0.35 + 0.65 * (Math.sin(time * 0.7) > -0.2 ? 1 : 0);
      if (M.mode === 'lost') eyes = 1 - smooth(M.lostT / 4);
      if (title) eyes = 0.75 + Math.sin(time * 1.3) * 0.25 * (Math.sin(time * 0.31) > 0.9 ? 0 : 1);
      const fstate = title ? 'stand' : M.mode === 'search' ? 'search' : M.mode === 'catch' ? 'lunge' : M.mode === 'stalk' && M.gap < 4 ? 'loom' : 'walk';
      R.animateFollower(beast, fstate, M.mode === 'pass' ? 2.5 : M.mode === 'lost' ? 2.6 : clamp(M.speed, 0, 12), dt, { eyes, close: M.mode === 'catch' ? clamp((r.catchT - 0.45) / 0.5, 0, 1) : 0, headP: M.mode === 'search' ? 0.5 : 0 });
      // ---- apparitions ----
      updateApparition(dt);
      eyeScale(beast, 0.026); if (phantom.root.visible) eyeScale(phantom, 0.022);
      updateBats(dt);
      // ---- danger ----
      let danger = 0;
      if (M.mode === 'stalk') danger = clamp(1 - (M.gap - 2) / 26, 0, 1);
      else if (M.mode === 'pass') danger = clamp(1 - Math.abs(M.gap) / 16, 0, 1) * 0.85;
      else if (M.mode === 'search' || M.mode === 'catch') danger = 1;
      if (title) danger = 0.1;
      r.danger = danger;
      eyeLight.intensity = title ? 0 : M.mode === 'catch' ? 2.2 : M.mode === 'stalk' ? danger * danger * 1.8 : 0;
      mixA.danger = damp(mixA.danger, danger, 3, dt);
      mixA.hide = damp(mixA.hide, (r.state === 'hide' || r.state === 'toHide') ? 1 : 0, 3, dt);
      // ---- lights follow ----
      moon.target.position.set(hp.x, 0, hp.z - 6); moon.position.copy(moon.target.position).addScaledVector(MOON, 60);
      rim.position.set(hp.x, hp.y + 1.9, hp.z + 1.4);
      rim.intensity = 1.5 + (r.stage >= 3 ? 1.2 : 0) + mixA.hide * 2.5;
      rim.distance = 7 + mixA.hide * 6;
      // ---- camera ----
      updateCamera(dt, hp, fp);
      // ---- motes ----
      const mp = motes.m.geometry.attributes.position, b = motes.base;
      for (let i = 0; i < motes.n; i++) {
        const k = i * 3, ox = b[k] + Math.sin(time * 0.3 + i) * 0.6, oy = b[k + 1] + Math.sin(time * 0.21 + i * 1.7) * 0.4, oz = b[k + 2];
        mp.setXYZ(i, camera.position.x + (((ox - camera.position.x) % 30) + 45) % 30 - 15, oy, camera.position.z + (((oz - camera.position.z) % 40) + 60) % 40 - 20);
      }
      mp.needsUpdate = true;
      // ---- sound ----
      sound(dt, hp, fp);
      // ---- HUD ----
      hud(dt);
      if (!skipRender) renderer.render(scene, camera);
    }
    function updateCamera(dt, hp, fp) {
      const r = run, M = r.M;
      const dpos = cam.dpos, dlook = cam.dlook;
      let k = 4.5;
      if (title || cam.swing > 0) {
        // stand before the wanderer, looking back down the trail; on start, swing around behind
        const sw = title ? 0 : smooth(1 - cam.swing / 1.4);
        const ang = sw * Math.PI, rad = lerp(5.2, 5.0, sw);
        const along = Math.cos(ang) * rad, side = lerp(1.1, 0, sw) + Math.sin(ang) * 2.2;
        at(r.s + along, r.u + side, lerp(1.05, 3.0, sw), dpos);
        at(lerp(r.s - 30, r.s + 10, sw), lerp(-0.2, r.u * 0.3, sw), lerp(2.2, 0.1, sw), dlook);
        if (title) { dpos.x += Math.sin(time * 0.17) * 0.25; dpos.y += Math.sin(time * 0.23) * 0.08; }
        k = 40;
      } else if (r.state === 'hide' || r.state === 'toHide') {
        // from up the trail, looking back: the cover, the wanderer curled behind it, and the way it will come
        const sp = r.spot, hw = sp.halfW;
        at(sp.s + 12, sp.hideU + sp.side * 1.6, 1.3, dpos);
        at(sp.s - 6, sp.side * hw * 0.5, 1.9, dlook);
        k = 2.2;
      } else if (r.state === 'caught') {
        // finally, it turns you around
        const t = smooth(r.catchT / 0.55);
        at(r.s + lerp(-4.0, 2.4, t), r.u + Math.sin(t * Math.PI) * 2.2, lerp(2.2, 1.35, t), dpos);
        beast.head.getWorldPosition(HEAD);
        dlook.copy(at(r.s + 8, r.u * 0.3, 0.8)).lerp(HEAD, t);
        k = 7;
      } else {
        const dg = mixA.danger, back = 5.0 - dg * 1.0;
        at(r.s - back, r.u * 0.55, 3.0 - dg * 0.45, dpos);
        at(r.s + 10, r.u * 0.3, 0.1, dlook);
        k = 4.5;
      }
      if (!cam.init) { cam.pos.copy(dpos); cam.look.copy(dlook); cam.init = true; }
      cam.pos.x = damp(cam.pos.x, dpos.x, k, dt); cam.pos.y = damp(cam.pos.y, dpos.y, k, dt); cam.pos.z = damp(cam.pos.z, dpos.z, k, dt);
      cam.look.x = damp(cam.look.x, dlook.x, k * 1.3, dt); cam.look.y = damp(cam.look.y, dlook.y, k * 1.3, dt); cam.look.z = damp(cam.look.z, dlook.z, k * 1.3, dt);
      if (cam.swing > 0) cam.swing = Math.max(0, cam.swing - dt);
      // shake: footfalls, exhaustion and dread; near-stillness in hiding
      const hidden = r.state === 'hide' || r.state === 'toHide';
      let amp = 0;
      if (!title) amp = hidden ? 0.004 + mixA.danger * 0.012 : (r.state === 'run' || r.state === 'vault' ? 0.03 + r.v * 0.002 : 0.008) + (r.exhausted ? 0.06 : 0) + mixA.danger * mixA.danger * 0.07 + (r.state === 'trip' ? 0.09 : 0);
      if (r.state === 'caught') amp = 0.05 * (1 - clamp(r.catchT / 1.5, 0, 1));
      cam.shake = damp(cam.shake, amp, 6, dt);
      const a = cam.shake;
      camera.position.set(cam.pos.x + Math.sin(time * 13.1) * a + Math.sin(time * 29) * a * 0.4, cam.pos.y + Math.sin(time * 17.3) * a * 0.8 + Math.abs(Math.sin(time * 6.5)) * a * 0.5, cam.pos.z + Math.sin(time * 11.7) * a * 0.5);
      camera.lookAt(cam.look);
      cam.roll = damp(cam.roll, r.exhausted && !hidden ? Math.sin(time * 1.6) * 0.03 : 0, 3, dt);
      camera.rotateZ(cam.roll);
      const fov = (hidden && !title ? 78 : 62) - mixA.danger * 5 + (r.state === 'run' ? r.v * 0.25 : 0);
      cam.fov = damp(cam.fov, fov, 3, dt);
      if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    }
    function updateApparition(dt) {
      const r = run, ap = r.apparition;
      phantom.root.visible = false; eyePair.visible = false;
      if (!ap) return;
      ap.t += dt;
      const fade = smooth(ap.t / 0.8) * (1 - smooth((ap.t - ap.dur + 0.9) / 0.9));
      // it never lets itself be reached
      const near = clamp((ap.s - r.s - 12) / 10, 0, 1);
      const vis = fade * near;
      if (ap.kind === 'eyes') {
        eyePair.visible = true; const p = at(ap.s, ap.u, 2.6 + Math.sin(ap.t) * 0.05); eyePair.position.copy(p);
        const blink = (ap.t % 1.7) < 0.12 ? 0.05 : 1;
        eyeGlow.opacity = vis * 0.95; const es = Math.max(1, camera.position.distanceTo(p) * 0.045); eyePair.scale.set(es, es * blink, es); eyePair.quaternion.copy(camera.quaternion);
      } else {
        phantom.root.visible = vis > 0.02;
        let u = ap.u;
        if (ap.kind === 'cross') u = lerp(-ap.side * 24, ap.side * 24, ap.t / ap.dur);
        const p = at(ap.s, u, 0); phantom.root.position.copy(p);
        phantom.root.rotation.y = TRAIL.yaw(ap.s) + (ap.kind === 'cross' ? (ap.side > 0 ? -Math.PI / 2 : Math.PI / 2) : Math.PI);
        phantom.skin.opacity = vis;
        R.animateFollower(phantom, ap.kind === 'cross' ? 'walk' : 'stand', 3.2, dt, { eyes: vis });
      }
      if (ap.t > ap.dur) r.apparition = null;
    }
    const _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3(), _be = new THREE.Euler();
    function updateBats(dt) {
      if (batState.t < 0) return;
      batState.t += dt;
      let alive = false;
      batState.list.forEach((b, i) => {
        const t = clamp((batState.t - b.delay) / 2.4, 0, 1);
        if (t < 1) alive = true;
        const u = lerp(b.u0, b.u1, t), p = at(b.s + Math.sin(t * 3 + b.wob) * 2, u, 0);
        p.y = b.y + Math.sin(t * 9 + b.ph) * 0.5 + groundY(p.x, p.z) * 0;
        const flap = 0.25 + Math.abs(Math.sin(batState.t * 26 + b.ph)) * 1.1;
        _be.set(0, TRAIL.yaw(b.s) + (b.u1 > b.u0 ? -Math.PI / 2 : Math.PI / 2), Math.sin(batState.t * 4 + b.ph) * 0.3); _bq.setFromEuler(_be);
        _bm.compose(p, _bq, _bs.set(t > 0 && t < 1 ? 1.4 : 0, flap, 1.4)); bats.setMatrixAt(i, _bm);
      });
      bats.instanceMatrix.needsUpdate = true;
      if (!alive) { batState.t = -1; bats.visible = false; }
    }

    // ---------- sound ----------
    function sound(dt, hp, fp) {
      const r = run, M = r.M;
      gustT -= dt; if (gustT <= 0) { gust = Math.random(); gustT = 2 + Math.random() * 5; }
      const fwd = _v.subVectors(cam.look, camera.position).normalize();
      audio.listener(camera.position.x, camera.position.y, camera.position.z, fwd.x, fwd.z);
      audio.follower(fp.x, fp.y + 3.2, fp.z);
      const near = beast.root.visible && M.mode !== 'lost' ? clamp(1 - Math.abs(M.vs - r.s) / 40, 0, 1) : 0;
      audio.mix({ danger: mixA.danger, hide: mixA.hide, stage: r.stage, gust, amb: title ? 0.8 : 1, over: mode === 'over' || mode === 'caught', mVol: (title ? 0 : near * near) * (M.mode === 'catch' ? 1.5 : 1) });
      if (mode !== 'play' && mode !== 'caught') return;
      // footfalls on the half-cycle of the gait
      if (r.state === 'run' || r.state === 'leave') { const sg = Math.sign(Math.sin(hero.phase)); if (sg !== r.stepSign) { r.stepSign = sg; audio.step(r.exhausted); } }
      if (beast.root.visible && M.mode !== 'search' && M.mode !== 'catch' && M.mode !== 'lost') {
        const sg = Math.sign(Math.sin(beast.phase)); if (sg !== r.mStepSign) { r.mStepSign = sg; const dist = Math.abs(M.vs - r.s); if (dist < 55) audio.mStep(clamp(1.3 - dist / 45, 0.15, 1.3)); }
      }
      // breath: ragged when spent, held when it is close
      r.breathT -= dt;
      const holding = (r.state === 'hide') && Math.abs(M.gap) < 5 && (M.mode === 'pass' || M.mode === 'search');
      const need = 1 - r.stamina / 100;
      if (!holding && r.breathT <= 0 && (need > 0.35 || r.exhausted || r.state === 'hide')) {
        r.inhale = !r.inhale; audio.breath(clamp(need + (r.exhausted ? 0.4 : 0), 0, 1) * (r.state === 'hide' ? 0.6 : 1), r.inhale);
        r.breathT = (r.state === 'hide' ? 0.9 : lerp(0.7, 0.32, need)) + Math.random() * 0.08;
      }
      r.heartT -= dt;
      if (mixA.danger > 0.3 && r.heartT <= 0) { audio.heart(mixA.danger); r.heartT = lerp(1.0, 0.42, mixA.danger); }
      for (const f of W.fallers) { if (f.started && !f.sound) { f.sound = true; audio.creak(2.5); audio.snap(); haptic('light'); } if (f.landed && !f.crashed) { f.crashed = true; audio.crash(); haptic('medium'); } }
    }

    // ---------- HUD ----------
    let distShown = -1;
    function hud(dt) {
      const r = run, M = r.M;
      if (stageTimer > 0) { stageTimer -= dt; if (stageTimer <= 0) H.stage.style.opacity = 0; }
      if (hintTimer > 0) { hintTimer -= dt; if (hintTimer <= 0) H.hint.style.opacity = 0; }
      H.vig.style.opacity = 0.75 + mixA.hide * 0.2;
      const pulse = 0.5 + 0.5 * Math.sin(time * (3 + mixA.danger * 5));
      H.danger.style.opacity = clamp((mixA.danger - 0.3) * 1.3, 0, 1) * (0.75 + pulse * 0.25);
      if (mode !== 'play') { if (mode !== 'paused') setCtx('', ''); return; }
      const dist = Math.floor(r.s);
      if (dist !== distShown) { distShown = dist; H.dist.innerHTML = dist + '<small>m</small>'; H.best.textContent = 'BEST ' + Math.max(save.best, dist) + ' M'; }
      H.barFill.style.transform = `scaleX(${(r.stamina / 100).toFixed(3)})`;
      H.bar.className = 'dl-bar' + (r.exhausted ? ' ex' : r.stamina < 30 ? ' low' : '');
      // contextual word
      const hidden = r.state === 'hide' || r.state === 'toHide';
      let cover = null;
      if (r.state === 'run' || r.state === 'stop' || r.state === 'vault') cover = W.coverNear(r.s, r.u);
      W.showRing(hidden ? null : cover, cover && !hidden ? 1 : 0, time);
      if (hidden) {
        const close = (M.mode === 'pass' && Math.abs(M.gap) < 12) || (M.mode === 'stalk' && M.gap < 12 && !M.spotted);
        const win = hideWindow(difficultyAt(r.s));
        if (M.mode === 'search') { setCtx('RUN', 'run'); H.ctx.style.opacity = 0.6 + pulse * 0.4; }
        else if (close || r.state === 'toHide') setCtx('', '');
        else { setCtx('RUN', 'run'); H.ctx.style.opacity = r.hideT > win * 0.7 ? 0.55 + pulse * 0.45 : 0.38; }
      } else if (r.exhausted) setCtx('EXHAUSTED', 'ex');
      else if (cover) setCtx('HIDE', 'hide');
      else setCtx('', '');
    }

    // ---------- flow ----------
    function begin(fromTitle) {
      audio.unlock();
      if (!fromTitle) newRun();
      title = false; mode = 'play'; hintStep = 0;
      cam.swing = fromTitle ? 1.4 : 0; if (!fromTitle) cam.init = false;
      H.title.classList.add('off'); H.over.classList.remove('on', 'show'); H.paused.classList.remove('on');
      H.fade.style.opacity = 0; H.eyes.style.opacity = 0;
      setHud(true); distShown = -1;
      showStage(0);
      if (save.tut < 2) showHint('HOLD TO RUN', 4, false);
      try { ctx.platform.start({ run: save.runs + 1 }); } catch (e) { }
      if (scoreTrack) try { scoreTrack.reset(); } catch (e) { }
    }
    function endRun() {
      const r = run; if (r.over) return; r.over = true;
      const dist = Math.floor(r.s), isBest = dist > save.best;
      save.best = Math.max(save.best, dist); save.runs++; if (dist > 40) save.tut = Math.max(save.tut, save.runs >= 2 ? 2 : 1);
      persist();
      try { ctx.platform.fail({ score: dist, distance: dist, reason: r.reason }); } catch (e) { }
      if (scoreTrack) { try { scoreTrack.set(dist); scoreTrack.submit('score', { label: dist + ' m' }).catch(() => { }); } catch (e) { } }
      H.ostats.innerHTML = `DISTANCE: <b>${dist} M</b><br>PERSONAL BEST: <b>${save.best} M</b>`;
      H.onew.textContent = isBest && dist > 0 ? 'A NEW PERSONAL BEST' : '';
      setHud(false); H.hint.style.opacity = 0; H.stage.style.opacity = 0;
      // capture, fade to black, its eyes, then the result
      ctx.timeout(() => { if (mode === 'caught') H.fade.style.opacity = 1; }, 1400);
      ctx.timeout(() => { if (mode === 'caught') { H.eyes.style.opacity = 1; haptic('error'); } }, 2000);
      ctx.timeout(() => { if (mode === 'caught') { mode = 'over'; H.over.classList.add('on'); ctx.timeout(() => H.over.classList.add('show'), 30); reportResult(); } }, 2900);
      ctx.timeout(() => { if (mode === 'over') H.eyes.style.opacity = 0.25; }, 3600);
    }
    // once per finished run, at the result screen
    function reportResult() {
      const dist = Math.floor(run.s);
      try { if (ctx.pulse && ctx.pulse.complete) ctx.pulse.complete({ score: dist, timeMs: Math.round(run.time * 1000), text: `I ran ${dist} m before it caught me.` }); } catch (e) { }
    }
    function showTitle() {
      newRun(); title = true; mode = 'title';
      H.title.classList.remove('off'); H.over.classList.remove('on', 'show'); H.paused.classList.remove('on');
      H.fade.style.opacity = 0; H.eyes.style.opacity = 0; setHud(false);
      H.tap.textContent = 'TAP TO BEGIN';
      H.tbest.textContent = save.best > 0 ? 'PERSONAL BEST  ' + save.best + ' M' : '';
      cam.init = false;
    }
    function pauseGame() {
      if (mode !== 'play') return;
      mode = 'paused'; input.hold = false; input.ptr = null; audio.suspend();
      H.pstats.innerHTML = `DISTANCE: <b>${Math.floor(run.s)} M</b>`;
      H.paused.classList.add('on');
    }
    function resumeGame() { if (mode !== 'paused') return; mode = 'play'; H.paused.classList.remove('on'); audio.resume(); }

    // ---------- input: one finger. Hold to run, slide to steer, let go to hide ----------
    const onDown = e => {
      audio.unlock();
      if (mode === 'title') { if (!H.tap.textContent.startsWith('TAP')) return; begin(true); }
      if (mode !== 'play') return;
      if (e.cancelable) e.preventDefault();
      input.ptr = { id: e.pointerId, x0: e.clientX, u0: run.uT }; input.hold = true;
      if (hintStep === 0 && save.tut < 2) H.hint.style.opacity = 0;
      try { canvas.setPointerCapture(e.pointerId); } catch (er) { }
    };
    const onMove = e => {
      if (!input.ptr || e.pointerId !== input.ptr.id || mode !== 'play') return;
      const hw = stageParam(run.s, 'halfW') - 0.3;
      if (run.state === 'run' || run.state === 'stop' || run.state === 'vault' || run.state === 'trip') run.uT = clamp(input.ptr.u0 + (e.clientX - input.ptr.x0) / (ctx.width * 0.34) * hw, -hw, hw);
    };
    const onUp = e => { if (!input.ptr || e.pointerId !== input.ptr.id) return; input.ptr = null; input.hold = input.keys.has('run'); };
    ctx.listen(canvas, 'pointerdown', onDown);
    ctx.listen(canvas, 'pointermove', onMove);
    ctx.listen(canvas, 'pointerup', onUp);
    ctx.listen(canvas, 'pointercancel', onUp);
    ctx.listen(canvas, 'contextmenu', e => e.preventDefault());
    const click = (b, fn) => ctx.listen(b, 'click', ev => { ev.stopPropagation(); audio.unlock(); fn(); });
    click(H.again, () => begin(false));
    click(H.menu, showTitle);
    click(H.resume, resumeGame);
    click(H.pmenu, () => { H.paused.classList.remove('on'); audio.resume(); if (run && !run.over) endRunQuiet(); showTitle(); });
    ctx.listen(H.pause, 'pointerdown', e => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); pauseGame(); });
    function endRunQuiet() { const dist = Math.floor(run.s); run.over = true; save.best = Math.max(save.best, dist); save.runs++; persist(); try { ctx.platform.fail({ score: dist, distance: dist, reason: 'quit' }); } catch (e) { } }
    const RUNKEYS = ['Space', 'ArrowUp', 'KeyW'];
    ctx.listen(window, 'keydown', e => {
      if (RUNKEYS.includes(e.code)) {
        e.preventDefault(); audio.unlock();
        if (mode === 'title') { if (H.tap.textContent.startsWith('TAP')) begin(true); }
        else if (mode === 'over' && !e.repeat) { begin(false); return; }
        input.keys.add('run'); input.hold = true;
      }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.keys.add('left');
      if (e.code === 'ArrowRight' || e.code === 'KeyD') input.keys.add('right');
      if (e.code === 'Escape' || e.code === 'KeyP') { if (mode === 'play') pauseGame(); else if (mode === 'paused') resumeGame(); }
    });
    ctx.listen(window, 'keyup', e => {
      if (RUNKEYS.includes(e.code)) { input.keys.delete('run'); input.hold = !!input.ptr; }
      if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.keys.delete('left');
      if (e.code === 'ArrowRight' || e.code === 'KeyD') input.keys.delete('right');
    });
    ctx.listen(window, 'blur', () => { input.keys.clear(); input.hold = false; input.ptr = null; if (mode === 'play') pauseGame(); });
    ctx.listen(document, 'visibilitychange', () => { if (document.hidden && mode === 'play') pauseGame(); });

    function layout(w, h) {
      // clear of the camera cutout, the home indicator and Plethora's logo button
      const sa = ctx.contentSafeArea || ctx.safeArea || {};
      const top = sa.top || 0, bot = sa.bottom || 0;
      H.top.style.paddingTop = (16 + top) + 'px';
      H.bottom.style.paddingBottom = (28 + bot) + 'px';
      safeBot = bot;
      H.title.style.paddingBottom = (16 + bot) + 'px'; H.title.style.paddingTop = (16 + top) + 'px';
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      // keep a portrait-like framing on wide screens
      camera.updateProjectionMatrix();
    }
    ctx.onResize(({ width, height }) => layout(width, height), { immediate: true });

    // ---------- loop ----------
    let acc = 0;
    const DT = 1 / 60;
    function tick(dtMs) {
      if (destroyed || window.__dlbManual) return;
      const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
      if (mode === 'play' || mode === 'caught' || mode === 'over') {
        if (mode === 'play') {
          const steer = (input.keys.has('right') ? 1 : 0) - (input.keys.has('left') ? 1 : 0);
          if (steer) { const hw = stageParam(run.s, 'halfW') - 0.3; run.uT = clamp(run.uT + steer * 4 * dt, -hw, hw); if (input.ptr) input.ptr.u0 += steer * 4 * dt; }
        }
        acc += dt; let n = 0;
        while (acc >= DT && n < 5) { if (mode === 'play' || mode === 'caught') step(DT); acc -= DT; n++; }
        if (n === 5) acc = 0;
      }
      if (mode === 'paused') return;
      frame(dt);
    }
    if (ctx.game && ctx.game.loop) ctx.game.loop({ update: dtMs => tick(dtMs) });
    else ctx.onFrame(dtMs => tick(dtMs));

    showTitle();
    // compile every program up front so nothing hitches when it first appears
    try {
      const hiddenOnes = [phantom.root, eyePair, bats];
      for (const o of hiddenOnes) o.visible = true;
      W.warm(true);
      renderer.compile(scene, camera);
      for (const o of hiddenOnes) o.visible = false;
      W.warm(false);
    } catch (e) { }
    try { frame(0.016); } catch (e) { bootFail('frame', e); return; }
    try { ctx.platform.ready(); } catch (e) { }

    if (window.__DLB_DEV) {
      window.__dlb = {
        begin, showTitle, pauseGame, resumeGame, input, camera, scene, renderer, W,
        jump(s) { W.reset((Math.random() * 1e9) | 0, s); run.s = s; run.stage = stageIndex(s); run.M.vs = s - run.M.gap; cam.init = false; frame(DT, true); },
        get run() { return run; }, get mode() { return mode; }, save: () => save,
        advance(sec, hold, settle) { if (hold != null) input.hold = hold; const n = Math.round(sec / DT); for (let i = 0; i < n && (mode === 'play' || mode === 'caught'); i++) { step(DT); if (settle === true) frame(DT, true); } if (!settle) frame(DT); },
        frame: n => { for (let i = 0; i < (n || 1); i++) frame(DT, i < (n || 1) - 1); }
      };
    }
  }
};

})();
