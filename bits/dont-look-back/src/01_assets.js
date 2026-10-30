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
