// =====================================================================
// The room. Built twice from the same function: once for the real side,
// once inside a z-mirrored group that the mirror shows. The mirror wall
// and the mirror itself exist only on the real side.
// Room: x in [-W, W], z in [0, D], y up. The glass is the plane z = 0.
// =====================================================================

const ROOM = { W: 2.7, D: 5.6, H: 3.3, wall: -0.06 };
const PAL = { char: '#100e0d', brown: '#3b2a1f', bronze: '#7a5c34', grey: '#5d5b58', amber: '#ffb15c', moon: '#9fb4d0' };

function createTextures(THREE, maxAniso) {
  const T = {};
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; };
  const tex = (c, rep, srgb) => { const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; if (rep) t.repeat.set(rep[0], rep[1]); if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; return t; };
  const rng = makeRng(11);
  // dark floorboards, 8 planks per tile, grain, gaps and wear
  {
    const [c, g] = cv(1024, 1024);
    const n = 8, pw = 1024 / n;
    for (let i = 0; i < n; i++) {
      let y0 = 0;
      while (y0 < 1024) {
        const len = 300 + rng() * 500;
        const l = 13 + rng() * 6, h = 22 + rng() * 6;
        g.fillStyle = `hsl(${h},${28 + rng() * 10}%,${l}%)`; g.fillRect(i * pw, y0, pw, len);
        for (let k = 0; k < 40; k++) { g.strokeStyle = `rgba(${rng() < 0.5 ? '10,6,4' : '70,50,36'},${0.08 + rng() * 0.12})`; g.lineWidth = 1 + rng() * 2; g.beginPath(); const x = i * pw + rng() * pw; g.moveTo(x, y0); g.bezierCurveTo(x + (rng() - 0.5) * 12, y0 + len * 0.3, x + (rng() - 0.5) * 12, y0 + len * 0.7, x + (rng() - 0.5) * 6, y0 + len); g.stroke(); }
        g.fillStyle = 'rgba(0,0,0,0.75)'; g.fillRect(i * pw, y0 + len - 2, pw, 3);
        y0 += len;
      }
      g.fillStyle = 'rgba(0,0,0,0.85)'; g.fillRect(i * pw, 0, 3, 1024);
    }
    for (let k = 0; k < 60; k++) { g.fillStyle = `rgba(120,100,80,${rng() * 0.05})`; g.beginPath(); g.ellipse(rng() * 1024, rng() * 1024, 20 + rng() * 120, 10 + rng() * 60, rng() * 3, 0, TAU); g.fill(); }
    T.floor = tex(c, [2.4, 2.4]);
  }
  // aged wallpaper: a faded damask over stripes, with water stains and grime
  {
    const [c, g] = cv(512, 512);
    g.fillStyle = '#2e2924'; g.fillRect(0, 0, 512, 512);
    for (let x = 0; x < 512; x += 64) { g.fillStyle = 'rgba(70,60,48,0.25)'; g.fillRect(x + 28, 0, 8, 512); g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 2, 512); }
    // a faded trellis with small sprigs, slightly irregular as if hand-printed
    g.strokeStyle = 'rgba(96,82,62,0.2)'; g.lineWidth = 2;
    for (let i = -4; i <= 8; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64 + 512, 512); g.stroke(); g.beginPath(); g.moveTo(i * 64 + 512, 0); g.lineTo(i * 64, 512); g.stroke(); }
    for (let y = 32; y < 512; y += 64) for (let x = (y / 64) % 2 ? 0 : 32; x < 512; x += 64) {
      g.fillStyle = 'rgba(104,88,64,0.22)';
      for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.785; g.beginPath(); g.ellipse(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 6, 2.6, a, 0, TAU); g.fill(); }
      g.beginPath(); g.arc(x, y, 2.2, 0, TAU); g.fill();
    }
    for (let k = 0; k < 9000; k++) { const v = rng(); g.fillStyle = `rgba(${v < 0.5 ? '0,0,0' : '90,80,64'},${rng() * 0.08})`; g.fillRect(rng() * 512, rng() * 512, 1 + rng() * 2, 1 + rng() * 3); }
    T.paper = tex(c, [1, 1]);
    // stains are painted on a separate, unrepeated layer so they don't tile
    const [s, sg] = cv(1024, 512);
    sg.fillStyle = '#fff'; sg.fillRect(0, 0, 1024, 512);
    for (let k = 0; k < 14; k++) {
      const x = rng() * 1024, y = rng() * 260, r = 30 + rng() * 140;
      const gr = sg.createRadialGradient(x, y, 0, x, y + r * 0.6, r * 1.4);
      gr.addColorStop(0, 'rgba(120,100,80,0.0)'); gr.addColorStop(0.7, 'rgba(110,90,70,0.35)'); gr.addColorStop(0.75, 'rgba(70,55,40,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      sg.fillStyle = gr; sg.beginPath(); sg.ellipse(x, y + r * 0.6, r, r * 1.6, 0, 0, TAU); sg.fill();
    }
    const fade = sg.createLinearGradient(0, 0, 0, 512); fade.addColorStop(0, 'rgba(40,30,20,0.55)'); fade.addColorStop(0.2, 'rgba(255,255,255,0)'); fade.addColorStop(0.85, 'rgba(255,255,255,0)'); fade.addColorStop(1, 'rgba(30,20,10,0.6)');
    sg.fillStyle = fade; sg.fillRect(0, 0, 1024, 512);
    T.stain = tex(s, [1, 1]); T.stain.wrapS = T.stain.wrapT = THREE.ClampToEdgeWrapping;
  }
  // panelled wainscot
  {
    const [c, g] = cv(512, 256);
    g.fillStyle = '#1d1511'; g.fillRect(0, 0, 512, 256);
    for (let x = 0; x < 512; x += 128) {
      g.fillStyle = '#271c16'; g.fillRect(x + 14, 30, 100, 196);
      g.strokeStyle = 'rgba(0,0,0,0.7)'; g.lineWidth = 4; g.strokeRect(x + 14, 30, 100, 196);
      g.strokeStyle = 'rgba(120,90,60,0.18)'; g.lineWidth = 2; g.strokeRect(x + 18, 34, 92, 188);
    }
    for (let k = 0; k < 400; k++) { g.strokeStyle = `rgba(0,0,0,${rng() * 0.15})`; g.beginPath(); const y = rng() * 256; g.moveTo(0, y); g.lineTo(512, y + (rng() - 0.5) * 6); g.stroke(); }
    g.fillStyle = '#120d0a'; g.fillRect(0, 0, 512, 14);
    T.wains = tex(c, [1, 1]);
  }
  // patina for bronze: roughness variation
  {
    const [c, g] = cv(256, 256);
    g.fillStyle = '#808080'; g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 3000; k++) { const v = Math.floor(rng() * 255); g.fillStyle = `rgba(${v},${v},${v},0.25)`; g.beginPath(); g.arc(rng() * 256, rng() * 256, 1 + rng() * 6, 0, TAU); g.fill(); }
    T.patina = tex(c, [2, 2], false);
  }
  const radial = (stops, size) => { const [c, g] = cv(size || 128, size || 128); const s = (size || 128) / 2; const gr = g.createRadialGradient(s, s, 0, s, s, s); for (const [o, col] of stops) gr.addColorStop(o, col); g.fillStyle = gr; g.fillRect(0, 0, s * 2, s * 2); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
  T.glow = radial([[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
  T.shadow = radial([[0, 'rgba(0,0,0,0.85)'], [0.5, 'rgba(0,0,0,0.45)'], [1, 'rgba(0,0,0,0)']]);
  T.flame = (() => { const [c, g] = cv(64, 128); const gr = g.createRadialGradient(32, 92, 2, 32, 80, 50); gr.addColorStop(0, 'rgba(255,250,230,1)'); gr.addColorStop(0.25, 'rgba(255,200,110,0.95)'); gr.addColorStop(0.6, 'rgba(230,110,30,0.35)'); gr.addColorStop(1, 'rgba(120,40,0,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(32, 4); g.bezierCurveTo(52, 50, 54, 92, 32, 120); g.bezierCurveTo(10, 92, 12, 50, 32, 4); g.fill(); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  T.beam = (() => { const [c, g] = cv(64, 256); const gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); const h = g.createLinearGradient(0, 0, 64, 0); h.addColorStop(0, 'rgba(0,0,0,1)'); h.addColorStop(0.3, 'rgba(0,0,0,0)'); h.addColorStop(0.7, 'rgba(0,0,0,0)'); h.addColorStop(1, 'rgba(0,0,0,1)'); g.globalCompositeOperation = 'destination-out'; g.fillStyle = h; g.fillRect(0, 0, 64, 256); return new THREE.CanvasTexture(c); })();
  return T;
}

function createRoomMaterials(THREE, T) {
  const M = {};
  M.floor = new THREE.MeshStandardMaterial({ map: T.floor, roughness: 0.62, metalness: 0, bumpMap: T.floor, bumpScale: 0.6 });
  M.paper = new THREE.MeshStandardMaterial({ map: T.paper, roughness: 0.92, bumpMap: T.paper, bumpScale: 0.4 });
  M.wains = new THREE.MeshStandardMaterial({ map: T.wains, roughness: 0.7, bumpMap: T.wains, bumpScale: 0.8 });
  M.wood = new THREE.MeshStandardMaterial({ color: '#2a1d15', roughness: 0.55 });
  M.darkWood = new THREE.MeshStandardMaterial({ color: '#170f0b', roughness: 0.6 });
  M.bronze = new THREE.MeshStandardMaterial({ color: '#7a5c34', metalness: 0.85, roughness: 0.55, roughnessMap: T.patina });
  M.bronzeDark = new THREE.MeshStandardMaterial({ color: '#4c3820', metalness: 0.8, roughness: 0.55, roughnessMap: T.patina });
  M.velvet = new THREE.MeshPhysicalMaterial({ color: '#2b1a17', roughness: 0.9, sheen: 1, sheenColor: new THREE.Color('#6e4a3c'), sheenRoughness: 0.5 });
  M.wax = new THREE.MeshStandardMaterial({ color: '#d9cdb4', roughness: 0.55, emissive: new THREE.Color('#5a3a10'), emissiveIntensity: 0.35 });
  M.ceiling = new THREE.MeshStandardMaterial({ color: '#141210', roughness: 1 });
  M.night = new THREE.MeshBasicMaterial({ color: '#1b2536' });
  M.glassPane = new THREE.MeshBasicMaterial({ color: '#9fb4d0', transparent: true, opacity: 0.06, depthWrite: false });
  M.book = ['#3a1f1a', '#25281f', '#2e2a22', '#1f1c24'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 }));
  M.paperEdge = new THREE.MeshStandardMaterial({ color: '#8a7f6a', roughness: 0.9 });
  M.cloth = new THREE.MeshStandardMaterial({ color: '#4a4640', roughness: 0.95, side: THREE.DoubleSide });
  return M;
}

// the window opening on the left wall (z range, y range)
const WIN = { z0: 1.0, z1: 2.3, y0: 1.05, y1: 2.55 };

function buildRoom(THREE, T, M, side, small) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, o) => {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (o && o.ry) m.rotation.y = o.ry; if (o && o.rx) m.rotation.x = o.rx; if (o && o.rz) m.rotation.z = o.rz;
    m.castShadow = !(o && o.noCast); m.receiveShadow = true; (o && o.parent || g).add(m); return m;
  };
  const { W, D, H } = ROOM;
  // floor
  const floor = add(new THREE.PlaneGeometry(W * 2, D - ROOM.wall), M.floor, 0, 0, (D + ROOM.wall) / 2, { rx: -Math.PI / 2, noCast: true });
  floor.material.map.repeat.set(W * 2 / 2.2, (D - ROOM.wall) / 2.2);
  add(new THREE.PlaneGeometry(W * 2, D), M.ceiling, 0, H, D / 2, { rx: Math.PI / 2, noCast: true });
  // walls: wallpaper above a panelled wainscot, with a dado rail and skirting
  const wall = (len, cx, cz, ry, holes) => {
    const shape = new THREE.Shape(); shape.moveTo(-len / 2, 0); shape.lineTo(len / 2, 0); shape.lineTo(len / 2, H); shape.lineTo(-len / 2, H); shape.lineTo(-len / 2, 0);
    for (const h of holes || []) { const p = new THREE.Path(); p.moveTo(h[0], h[1]); p.lineTo(h[0], h[3]); p.lineTo(h[2], h[3]); p.lineTo(h[2], h[1]); p.lineTo(h[0], h[1]); shape.holes.push(p); }
    const geo = new THREE.ShapeGeometry(shape);
    // uv in metres so the paper tiles at a real scale
    const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 0.85, uv.getY(i) / 0.85);
    const m = add(geo, M.paper, cx, 0, cz, { ry });
    const st = new THREE.Mesh(new THREE.PlaneGeometry(len, H), new THREE.MeshBasicMaterial({ map: T.stain, transparent: true, blending: THREE.MultiplyBlending, premultipliedAlpha: true, depthWrite: false }));
    st.position.set(cx, H / 2, cz); st.rotation.y = ry; st.translateZ(0.002); g.add(st);
    const wa = new THREE.Mesh(new THREE.BoxGeometry(len, 0.92, 0.03), M.wains); wa.position.set(cx, 0.46, cz); wa.rotation.y = ry; wa.translateZ(0.015); wa.receiveShadow = true; wa.castShadow = true; g.add(wa);
    wa.material.map.repeat.set(len / 1.4, 1);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.05, 0.05), M.darkWood); rail.position.set(cx, 0.93, cz); rail.rotation.y = ry; rail.translateZ(0.03); rail.castShadow = rail.receiveShadow = true; g.add(rail);
    const cor = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.06), M.darkWood); cor.position.set(cx, H - 0.06, cz); cor.rotation.y = ry; cor.translateZ(0.03); g.add(cor);
    return m;
  };
  if (side === 'real') wall(W * 2, 0, ROOM.wall, 0);
  // left wall carries the window: shape x runs along +z when rotated
  wall(D, -W, D / 2, Math.PI / 2, [[WIN.z0 - D / 2, WIN.y0, WIN.z1 - D / 2, WIN.y1].map((v, i) => (i % 2 === 0 ? -v : v))].map(h => [Math.min(h[0], h[2]), h[1], Math.max(h[0], h[2]), h[3]]));
  wall(D, W, D / 2, -Math.PI / 2);
  wall(W * 2, 0, D, Math.PI);
  // window: frame, mullions and the night outside
  {
    const wz = (WIN.z0 + WIN.z1) / 2, wy = (WIN.y0 + WIN.y1) / 2, ww = WIN.z1 - WIN.z0, wh = WIN.y1 - WIN.y0;
    const fr = (w, h, d, x, y, z) => add(new THREE.BoxGeometry(w, h, d), M.darkWood, x, y, z);
    fr(0.14, 0.07, ww + 0.14, -W + 0.02, WIN.y0 - 0.03, wz); fr(0.1, 0.06, ww + 0.1, -W + 0.01, WIN.y1 + 0.03, wz);
    fr(0.1, wh + 0.1, 0.06, -W + 0.01, wy, WIN.z0 - 0.03); fr(0.1, wh + 0.1, 0.06, -W + 0.01, wy, WIN.z1 + 0.03);
    fr(0.05, wh, 0.035, -W - 0.02, wy, wz); fr(0.05, 0.035, ww, -W - 0.02, wy + 0.12, wz); fr(0.05, 0.035, ww, -W - 0.02, wy - 0.38, wz);
    const night = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 2.2), M.night); night.position.set(-W - 0.35, wy, wz); night.rotation.y = Math.PI / 2; g.add(night);
    const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(0.09, 24), new THREE.MeshBasicMaterial({ color: '#c9d6e6' })); moonDisc.position.set(-W - 0.33, wy + 0.42, wz - 0.25); moonDisc.rotation.y = Math.PI / 2; g.add(moonDisc);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(ww, wh), M.glassPane); pane.position.set(-W - 0.02, wy, wz); pane.rotation.y = Math.PI / 2; g.add(pane);
    // a torn curtain, hanging still
    const cg = new THREE.PlaneGeometry(0.42, wh + 0.4, 6, 12); const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); cp.setZ(i, Math.sin(x * 22) * 0.025 + Math.sin(y * 3 + x * 9) * 0.01); }
    cg.computeVertexNormals();
    const cur = add(cg, M.cloth, -W + 0.08, wy + 0.1, WIN.z1 + 0.18, { ry: Math.PI / 2 }); cur.castShadow = true;
  }
  // furniture: a side table with a candle, an armchair, a few books
  const candle = {};
  {
    const tx = -1.2, tz = 0.62;
    add(new THREE.CylinderGeometry(0.27, 0.27, 0.035, 28), M.wood, tx, 0.68, tz);
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 28), M.darkWood, tx, 0.635, tz);
    for (let i = 0; i < 3; i++) { const a = i / 3 * TAU + 0.4; const leg = add(new THREE.CylinderGeometry(0.018, 0.012, 0.64, 8), M.darkWood, tx + Math.cos(a) * 0.17, 0.32, tz + Math.sin(a) * 0.17); leg.rotation.set(Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12); }
    add(new THREE.CylinderGeometry(0.07, 0.05, 0.015, 20), M.bronze, tx + 0.05, 0.705, tz);
    add(new THREE.CylinderGeometry(0.018, 0.024, 0.05, 12), M.bronze, tx + 0.05, 0.735, tz);
    const wax = add(new THREE.CylinderGeometry(0.022, 0.024, 0.15, 14), M.wax, tx + 0.05, 0.83, tz);
    for (let i = 0; i < 4; i++) { const a = i * 1.7; const d = add(new THREE.SphereGeometry(0.008, 8, 6), M.wax, tx + 0.05 + Math.cos(a) * 0.022, 0.86 + Math.sin(i * 3) * 0.03, tz + Math.sin(a) * 0.022); d.scale.set(0.8, 2.2, 0.8); }
    void wax;
    candle.pos = [tx + 0.05, 0.935, tz];
    const fm = new THREE.SpriteMaterial({ map: T.flame, color: '#fff2d8', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    candle.flame = new THREE.Sprite(fm); candle.flame.scale.set(0.035, 0.07, 1); candle.flame.position.set(candle.pos[0], candle.pos[1], candle.pos[2]); g.add(candle.flame);
    const hm = new THREE.SpriteMaterial({ map: T.glow, color: '#ff9a40', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending });
    candle.halo = new THREE.Sprite(hm); candle.halo.scale.set(0.6, 0.6, 1); candle.halo.position.copy(candle.flame.position); g.add(candle.halo);
    // books on the table and the floor
    const book = (x, y, z, w, h, d, ry, i) => { const b = add(new THREE.BoxGeometry(w, h, d), M.book[i % 4], x, y, z, { ry }); add(new THREE.BoxGeometry(w * 0.96, h * 0.8, d * 0.9), M.paperEdge, x, y, z + 0.004, { ry, noCast: true }); return b; };
    book(tx - 0.1, 0.716, tz + 0.05, 0.16, 0.035, 0.22, 0.3, 0); book(tx - 0.11, 0.749, tz + 0.06, 0.14, 0.03, 0.2, 0.15, 1);
    book(1.05, 0.03, 1.55, 0.22, 0.06, 0.3, 0.6, 2); book(1.07, 0.085, 1.52, 0.18, 0.05, 0.26, 0.9, 3); book(1.0, 0.13, 1.56, 0.17, 0.04, 0.24, 0.4, 0);
  }
  {
    // armchair, angled toward the mirror, its velvet worn
    const ch = new THREE.Group(); ch.position.set(1.75, 0, 1.05); ch.rotation.y = -0.75; g.add(ch);
    const p = { parent: ch };
    add(new THREE.BoxGeometry(0.72, 0.16, 0.66), M.velvet, 0, 0.42, 0, p);
    add(new THREE.BoxGeometry(0.76, 0.2, 0.7), M.darkWood, 0, 0.27, 0, p);
    const back = add(new THREE.BoxGeometry(0.72, 0.78, 0.14), M.velvet, 0, 0.8, -0.3, p); back.rotation.x = -0.12;
    add(new THREE.BoxGeometry(0.12, 0.26, 0.64), M.velvet, -0.36, 0.56, 0.02, p); add(new THREE.BoxGeometry(0.12, 0.26, 0.64), M.velvet, 0.36, 0.56, 0.02, p);
    for (const [x, z] of [[-0.32, -0.28], [0.32, -0.28], [-0.32, 0.28], [0.32, 0.28]]) add(new THREE.CylinderGeometry(0.03, 0.02, 0.18, 8), M.darkWood, x, 0.09, z, p);
    // a dust sheet thrown over one arm
    const cg = new THREE.PlaneGeometry(0.5, 0.7, 8, 10); const cp = cg.attributes.position;
    for (let i = 0; i < cp.count; i++) { const x = cp.getX(i), y = cp.getY(i); cp.setZ(i, Math.sin(x * 14 + y * 4) * 0.02 - Math.max(0, y) * 0.25); }
    cg.computeVertexNormals();
    const cl = add(cg, M.cloth, 0.38, 0.55, 0.05, { parent: ch, ry: Math.PI / 2 }); cl.rotation.x = -0.2;
  }
  return { group: g, candle };
}

// The mirror: an arched bronze frame with layered mouldings and a crest.
function buildMirror(THREE, M) {
  const g = new THREE.Group();
  const w = 1.42, h = 1.78, rise = 0.3, bottom = 0.14;
  const arch = (inset) => {
    const s = new THREE.Shape(), hw = w / 2 - inset, y0 = bottom + inset, y1 = bottom + h - inset * 0.5;
    const r = rise - inset * 0.3;
    s.moveTo(-hw, y0); s.lineTo(hw, y0); s.lineTo(hw, y1);
    s.quadraticCurveTo(hw * 0.55, y1 + r * 0.95, 0, y1 + r); s.quadraticCurveTo(-hw * 0.55, y1 + r * 0.95, -hw, y1); s.lineTo(-hw, y0);
    return s;
  };
  const ring = (outer, inner, depth, bevel, mat, z) => {
    const s = arch(outer); s.holes.push(arch(inner));
    const geo = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 24 });
    const m = new THREE.Mesh(geo, mat); m.position.z = z; m.castShadow = true; m.receiveShadow = true; g.add(m); return m;
  };
  ring(-0.17, -0.02, 0.05, 0.025, M.bronzeDark, -0.05);
  ring(-0.12, 0.0, 0.06, 0.02, M.bronze, -0.02);
  ring(-0.02, 0.035, 0.03, 0.012, M.bronze, 0.02);
  // the glass shape, so the shader knows the opening
  const glassShape = arch(0.03);
  // crest: scrolls and a finial
  const crestY = bottom + h + rise + 0.12;
  const tor = new THREE.TorusGeometry(0.07, 0.016, 8, 20, Math.PI * 1.4);
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(tor, M.bronze); t.position.set(0.12 * s, crestY - 0.02, 0.04); t.rotation.z = s > 0 ? 2.2 : 0.95 - Math.PI * 0.4 + Math.PI; t.castShadow = true; g.add(t);
    const t2 = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.012, 8, 16, Math.PI * 1.5), M.bronze); t2.position.set(0.25 * s, crestY - 0.08, 0.035); t2.rotation.z = s > 0 ? 3.6 : -0.5; g.add(t2);
    // side rosettes and feet
    const ro = new THREE.Mesh(new THREE.SphereGeometry(0.04, 14, 10), M.bronze); ro.scale.z = 0.45; ro.position.set((w / 2 + 0.13) * s, bottom + h * 0.55, 0.04); g.add(ro);
  }
  const fin = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), M.bronze); fin.position.set(0, crestY + 0.04, 0.04); fin.scale.set(0.8, 1.2, 0.6); g.add(fin);
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.bronze); shell.scale.set(1.1, 0.9, 0.3); shell.position.set(0, crestY - 0.08, 0.03); g.add(shell);
  // a cheval stand: the glass swings forward between two turned posts
  const pivotY = bottom + (h + rise) * 0.5;
  const stand = new THREE.Group();
  for (const s of [-1, 1]) {
    const x = (w / 2 + 0.2) * s;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.036, pivotY + 0.12, 12), M.wood); post.position.set(x, (pivotY + 0.12) / 2, 0); post.castShadow = post.receiveShadow = true; stand.add(post);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.045, 14, 10), M.bronze); cap.position.set(x, pivotY + 0.15, 0); stand.add(cap);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.1, 14), M.bronze); knob.rotation.z = Math.PI / 2; knob.position.set(x - 0.06 * s, pivotY, 0); stand.add(knob);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.05, 0.6), M.wood); foot.position.set(x, 0.025, 0.02); foot.castShadow = foot.receiveShadow = true; stand.add(foot);
  }
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, w + 0.4, 10), M.wood); bar.rotation.z = Math.PI / 2; bar.position.set(0, 0.12, -0.2); stand.add(bar);
  return { group: g, stand, pivotY, glassShape, rect: { x0: -w / 2, x1: w / 2, y0: bottom, y1: bottom + h + rise } };
}

// Dust motes: one geometry, shown in both rooms so the reflection matches.
function createDust(THREE, T, n) {
  const geo = new THREE.BufferGeometry();
  const p = new Float32Array(n * 3), seed = new Float32Array(n);
  const r = makeRng(5);
  for (let i = 0; i < n; i++) { p[i * 3] = (r() - 0.5) * 4.6; p[i * 3 + 1] = r() * 2.8; p[i * 3 + 2] = 0.1 + r() * 4.2; seed[i] = r() * 100; }
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const mat = new THREE.PointsMaterial({ color: '#d8c8b0', size: 0.012, map: T.glow, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
  return {
    geo, mat,
    update(t, dt) {
      for (let i = 0; i < n; i++) {
        const s = seed[i];
        p[i * 3] += Math.sin(t * 0.13 + s) * 0.0009;
        p[i * 3 + 1] += (Math.sin(t * 0.21 + s * 1.7) * 0.0006 - 0.00025);
        p[i * 3 + 2] += Math.cos(t * 0.11 + s * 0.6) * 0.0007;
        if (p[i * 3 + 1] < 0.02) p[i * 3 + 1] = 2.8;
      }
      geo.attributes.position.needsUpdate = true;
    }
  };
}
