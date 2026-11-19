// ---------------------------------------------------------------------------
// The stage: a perspective camera looking at the gameplay plane (z = 0), with
// painted layers at real depths behind and in front, so parallax and
// atmospheric perspective come from the camera and the fog, not from tricks.
// ---------------------------------------------------------------------------

function createStage(THREE, canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: quality > 0.6, alpha: false, powerPreference: 'high-performance' });
  renderer.setClearColor(0xeee4cf, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 900);
  camera.position.set(0, 4, 52);
  scene.add(camera);
  scene.fog = new THREE.Fog(0xeee4cf, 58, 760);

  // Sky: a gradient card stuck to the back of the camera.
  const skyMat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, haze: { value: new THREE.Color() },
      sun: { value: new THREE.Color() }, sunPos: { value: new THREE.Vector2(0.72, 0.62) }, aspect: { value: 1 }
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      uniform vec3 top; uniform vec3 mid; uniform vec3 haze; uniform vec3 sun; uniform vec2 sunPos; uniform float aspect;
      varying vec2 vUv;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){
        float y = vUv.y;
        vec3 c = mix(haze, mid, smoothstep(0.18, 0.55, y));
        c = mix(c, top, smoothstep(0.55, 1.0, y));
        vec2 d = (vUv - sunPos) * vec2(aspect, 1.0);
        float r = length(d);
        c = mix(c, sun, 0.55 * exp(-r * 5.0) + 0.35 * exp(-r * 18.0));
        c += (hash(vUv * 900.0) - 0.5) * 0.012;
        gl_FragColor = vec4(c, 1.0);
      }`,
    depthWrite: false, depthTest: false, fog: false
  });
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), skyMat);
  sky.renderOrder = -100; sky.frustumCulled = false;
  camera.add(sky);

  return { THREE, renderer, scene, camera, sky, skyMat, quality };
}

// Fit the camera so the phone shows about 12.5 m across in portrait.
function fitStage(stage, w, h, dpr) {
  const { renderer, camera, sky } = stage;
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  const aspect = w / h;
  camera.aspect = aspect;
  const viewW = clamp(aspect * 27, 12.5, 30);
  const viewH = viewW / aspect;
  const dist = (viewH / 2) / Math.tan(camera.fov * Math.PI / 360);
  stage.dist = dist; stage.viewW = viewW; stage.viewH = viewH;
  camera.near = 2; camera.far = dist + 900;
  camera.updateProjectionMatrix();
  // sky card fills the frustum at a fixed depth
  const sd = dist + 840;
  const sh = 2 * sd * Math.tan(camera.fov * Math.PI / 360);
  sky.position.set(0, 0, -sd); sky.scale.set(sh * aspect * 0.55, sh * 0.55, 1);
  stage.skyMat.uniforms.aspect.value = aspect;
}

// ---- texture cache per palette --------------------------------------------
function makeTexKit(stage, P, region) {
  const { THREE, renderer } = stage;
  const cache = new Map();
  const maxAniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  const tex = (key, paint, opts) => {
    if (cache.has(key)) return cache.get(key);
    const c = paint();
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
    if (opts && opts.repeat) { t.wrapS = THREE.RepeatWrapping; if (opts.repeat === 'xy') t.wrapT = THREE.RepeatWrapping; }
    t.userData = { w: c.width, h: c.height };
    cache.set(key, t);
    return t;
  };
  const kit = { P, region, tex, cache, mats: [] };
  kit.dispose = () => { for (const t of cache.values()) t.dispose(); for (const m of kit.mats) m.dispose(); cache.clear(); };
  return kit;
}

// A painted card: canvas pixel (ax, ay) sits at the local origin.
function card(stage, kit, t, pxPerM, ax, ay, opts) {
  const { THREE } = stage;
  const w = t.userData.w / pxPerM, h = t.userData.h / pxPerM;
  const geo = new THREE.PlaneGeometry(w, h);
  geo.translate(w / 2 - ax / pxPerM, -h / 2 + ay / pxPerM, 0);
  const mat = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: !(opts && opts.noFog), opacity: (opts && opts.opacity) || 1 });
  if (opts && opts.color) mat.color.set(opts.color);
  kit.mats.push(mat);
  const m = new THREE.Mesh(geo, mat);
  return m;
}

// A solid strip (rope, cable, lip line), unit length along +x, centred on y.
function strip(stage, kit, color, width, opts) {
  const { THREE } = stage;
  const geo = new THREE.PlaneGeometry(1, width);
  geo.translate(0.5, 0, 0);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, opacity: (opts && opts.opacity) || 1 });
  kit.mats.push(mat);
  return new THREE.Mesh(geo, mat);
}
function setStrip(m, x0, y0, x1, y1) {
  m.position.set(x0, y0, m.position.z);
  m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
  m.scale.x = Math.max(0.001, Math.hypot(x1 - x0, y1 - y0));
}

// ---- building the world for a route -----------------------------------------
function buildWorldView(stage, W, regionIdx, opts) {
  const { THREE, scene } = stage;
  const P = PALETTES[regionIdx];
  stage.kits = stage.kits || {};
  const kit = stage.kits[regionIdx] || (stage.kits[regionIdx] = makeTexKit(stage, P, regionIdx));
  const root = new THREE.Group();
  scene.add(root);
  const rng = makeRng((W.spec.seed ^ 0xabcdef) >>> 0);
  const evening = regionIdx === 3;
  const view = { root, kit, P, sysViews: [], anims: [], letters: [], W, clones: [], mats: [] };
  kit.mats = view.mats;

  // route extents
  let ymin = 1e9, ymax = -1e9;
  for (const s of W.surfaces) { ymin = Math.min(ymin, s.ymin); ymax = Math.max(ymax, s.ymax); }
  const x0 = -30, x1 = W.finalX + 40;
  view.ymin = ymin; view.ymax = ymax;

  // fog and sky colours
  scene.fog.color.set(P.haze);
  stage.renderer.setClearColor(new THREE.Color(P.haze), 1);
  const u = stage.skyMat.uniforms;
  u.top.value.set(P.skyTop); u.mid.value.set(P.skyMid); u.haze.value.set(P.haze); u.sun.value.set(P.sun);

  // far monuments
  const monKinds = ['spire', 'discs', 'mesa', 'stair'];
  const monTex = monKinds.map((k, i) => kit.tex('mon' + k, () => paintMonument(100 + i + regionIdx * 10, P, k)));
  for (let x = x0 - 200, i = 0; x < x1 + 200; x += 70 + rng() * 60, i++) {
    const k = i % 4 === 3 ? 2 : rng.int(0, 3);
    const t = monTex[k];
    const hgt = 150 + rng() * 120;
    const m = card(stage, kit, t, 1024 / hgt, 256, 1024);
    m.position.set(x, ymin - 70 - rng() * 30, -380 - rng() * 90);
    root.add(m);
  }
  // a distant wheel that never stops, and the giant arm
  const fw = card(stage, kit, kit.tex('farwheel', () => paintFarWheel(7, P)), 512 / 70, 256, 256);
  fw.position.set(x0 + (x1 - x0) * 0.35, ymin + 26, -300);
  root.add(fw);
  view.anims.push(t => { fw.rotation.z = -t * 0.05; });
  // distant kin of the walking house, crossing the horizon
  for (let i = 0; i < 2; i++) {
    const k = card(stage, kit, kit.tex('kin', () => paintStriderBody(3, P, true)), 512 / 22, 256, 200);
    const legs = [];
    for (let l = 0; l < 4; l++) { const s = strip(stage, kit, mixC(P.far, P.ink, 0.25), 0.9); s.position.z = -230 - i * 30 - 0.1; root.add(s); legs.push(s); }
    k.position.z = -230 - i * 30;
    root.add(k);
    const base = x0 + (x1 - x0) * (0.2 + 0.5 * i), yb = ymin + 6 + i * 6;
    view.anims.push(t => {
      const x = base + t * (0.6 + i * 0.3), ph = t * (0.6 + i * 0.3) / 7;
      const y = yb + 34 + Math.abs(Math.sin(ph * Math.PI)) * 0.8;
      k.position.x = x; k.position.y = y;
      for (let l = 0; l < 4; l++) {
        const hip = x - 6 + (l % 2) * 12 + (l > 1 ? 1.5 : 0);
        const sw = Math.sin(ph * Math.PI + l * Math.PI) * 3;
        setStrip(legs[l], hip, y - 1, hip + sw, y - 40);
      }
    });
  }

  // ridges
  const ridgeFar = kit.tex('ridgeFar', () => paintRidge(21 + regionIdx, P, 'far'), { repeat: 'x' });
  const ridgeNear = kit.tex('ridgeNear', () => paintRidge(41 + regionIdx, P, 'near'), { repeat: 'x' });
  const ridge = (t, z, h, y, reps) => {
    const w = (x1 - x0) + 600;
    const m = card(stage, kit, t, 1, 0, 0);
    m.geometry.dispose();
    m.geometry = new THREE.PlaneGeometry(w, h); m.geometry.translate(w / 2, -h / 2, 0);
    t.repeat.set(reps, 1);
    m.position.set(x0 - 300, y, z);
    root.add(m);
    return m;
  };
  ridge(ridgeFar, -210, 90, ymin + 30, Math.ceil((x1 - x0 + 600) / 240));
  ridge(ridgeNear, -110, 60, ymin + 12, Math.ceil((x1 - x0 + 600) / 150));

  // clouds
  const cloudTex = [0, 1, 2].map(i => kit.tex('cloud' + i, () => paintCloud(300 + i, P)));
  for (let i = 0; i < Math.ceil((x1 - x0) / 18); i++) {
    const z = -40 - rng() * 260;
    const m = card(stage, kit, cloudTex[i % 3], 512 / (16 + rng() * 22), 256, 128, { opacity: 0.85 });
    const bx = x0 + rng() * (x1 - x0), by = ymin + rng() * (ymax - ymin + 40) + 8 + (-z) * 0.08;
    m.position.set(bx, by, z);
    root.add(m);
    const sp = 0.2 + rng() * 0.4;
    view.anims.push(t => { m.position.x = bx + t * sp; });
  }

  // near background houses and trees, roughly following the route's height
  const houseTex = [0, 1, 2, 3, 4, 5].map(i => kit.tex('house' + i, () => paintHouse(500 + i * 13 + regionIdx * 101, P, { lit: evening })));
  const treeTex = [0, 1, 2].map(i => kit.tex('tree' + i, () => paintTree(700 + i + regionIdx * 3, P)));
  const yAtX = x => {
    let best = 0, bd = 1e9;
    for (const m of W.modules) { const c = (m.x0 + m.x1) / 2, d = Math.abs(c - x); if (d < bd) { bd = d; best = m.y; } }
    return best;
  };
  for (let x = x0; x < x1; x += 7 + rng() * 9) {
    const z = -16 - rng() * 20;
    const y = yAtX(x) - 6 - rng() * 4;
    const t = houseTex[rng.int(0, 5)];
    const m = card(stage, kit, t, 256 / (4.5 + rng() * 2.5), 128, 640, { color: mixC('#ffffff', P.far, clamp((-z - 16) / 30, 0, 0.6)) });
    m.material.alphaMap = fadeTex(stage, kit);
    m.position.set(x, y - 2, z);
    root.add(m);
    if (rng.chance(0.4)) {
      const tr = card(stage, kit, treeTex[rng.int(0, 2)], 256 / (3 + rng() * 2), 128, 320);
      tr.position.set(x + 2 + rng() * 2, y + 1 + rng() * 4, z + 1.5);
      root.add(tr);
      const ph = rng() * 6;
      view.anims.push(t2 => { tr.rotation.z = Math.sin(t2 * 0.9 + ph) * 0.015; });
    }
  }

  // mist below and in front: it hangs at the bottom of the view, and falling
  // means falling into it
  const mistTex = kit.tex('mist', () => paintMist(11 + regionIdx, P), { repeat: 'x' });
  const mists = [];
  const mistCol = mixC(P.haze, '#ffffff', 0.4);
  for (const [z, dy, op] of [[-34, 3.2, 0.85], [-8, 1.4, 0.9], [4, -0.6, 1]]) {
    const w = (x1 - x0) + 400, h = 9;
    const m = card(stage, kit, mistTex, 1, 0, 0, { opacity: op });
    m.geometry.dispose(); m.geometry = new THREE.PlaneGeometry(w, h); m.geometry.translate(w / 2, -h / 2 + 4.5, 0);
    m.material.map = mistTex.clone(); m.material.map.needsUpdate = true; m.material.map.repeat.set(w / 40, 1);
    view.clones.push(m.material.map);
    const below = strip(stage, kit, mistCol, 60, { opacity: op });
    below.scale.x = w; below.position.set(0, -30 - 4.5 + 0.2, 0);
    m.add(below);
    m.position.set(x0 - 200, 0, z);
    root.add(m);
    mists.push({ m, dy, z });
  }
  view.mists = mists;
  view.anims.push(t => { mists.forEach((o, i) => { o.m.material.map.offset.x = t * (0.004 + i * 0.003); }); });

  // water bands for ferry crossings
  const waterTex = kit.tex('water', () => paintWater(5, P), { repeat: 'x' });
  for (const wv of W.waters) {
    const w = wv.x1 - wv.x0 + 1.2;
    for (const [z, op, dy, h] of [[-0.8, 1, 0.05, 6], [0.25, 0.82, -0.12, 3]]) {
      const m = card(stage, kit, waterTex, 1, 0, 0, { opacity: op });
      m.geometry.dispose(); m.geometry = new THREE.PlaneGeometry(w, h); m.geometry.translate(w / 2, -h / 2, 0);
      m.material.map = waterTex.clone(); m.material.map.needsUpdate = true; m.material.map.repeat.set(w / 2.2, 1);
      view.clones.push(m.material.map);
      m.material.alphaMap = fadeTex(stage, kit);
      m.position.set(wv.x0 - 0.6, wv.y + 0.25 + dy, z);
      root.add(m);
      const mm = m;
      view.anims.push(t => { mm.material.map.offset.x = t * (z > 0 ? 0.05 : -0.02); });
    }
  }

  // foreground silhouettes, sparse
  const fgKinds = ['vines', 'reeds'];
  const fgTex = fgKinds.map((k, i) => kit.tex('fg' + k, () => paintForeground(900 + i, P, k)));
  for (let x = x0 + 10; x < x1; x += 22 + rng() * 26) {
    const k = rng.int(0, 1);
    const y = yAtX(x);
    const m = card(stage, kit, fgTex[k], 256 / 5, 128, k === 0 ? 0 : 512, { noFog: true, opacity: 0.8 });
    m.position.set(x, k === 0 ? y + 14 : y - 7, 10 + rng() * 4);
    root.add(m);
    const ph = rng() * 6;
    view.anims.push(t => { m.rotation.z = Math.sin(t * 0.7 + ph) * 0.02; });
  }

  // gameplay systems
  for (const sys of W.systems) {
    const v = buildSystemView(stage, kit, sys, rng, view);
    if (v) { root.add(v.group); view.sysViews.push(v); }
  }

  // lost letters
  const letterTex = kit.tex('letter', () => paintLetter(P));
  for (const L of W.letters) {
    const m = card(stage, kit, letterTex, 128 / 1.1, 64, 64);
    m.position.set(L.x, L.y, 0.3);
    root.add(m);
    view.letters.push({ L, m, taken: false, fade: 0 });
  }

  view.update = (t, camX, camY, viewH) => {
    for (const o of view.mists) { const pz = (stage.dist - o.z) / stage.dist; o.m.position.y = camY - viewH * 0.5 * pz + o.dy; }
    for (const a of view.anims) a(t);
    for (const v of view.sysViews) if (Math.abs(v.cx - camX) < v.reach + 22) { v.group.visible = true; v.update(t); } else v.group.visible = false;
    for (const lv of view.letters) {
      if (lv.taken) { lv.fade = Math.min(1, lv.fade + 0.03); lv.m.material.opacity = 1 - lv.fade; lv.m.position.y += 0.03; lv.m.scale.setScalar(1 + lv.fade * 0.6); lv.m.visible = lv.fade < 1; }
      else { lv.m.position.y = lv.L.y + Math.sin(t * 2 + lv.L.x) * 0.12; lv.m.rotation.z = Math.sin(t * 1.3 + lv.L.x) * 0.08; }
    }
  };
  view.dispose = () => { scene.remove(root); root.traverse(o => { if (o.geometry) o.geometry.dispose(); }); view.clones.forEach(t => t.dispose()); view.mats.forEach(m => m.dispose()); };
  return view;
}

// ---- one system ------------------------------------------------------------------
function buildSystemView(stage, kit, sys, rng, view) {
  const { THREE } = stage;
  const P = kit.P;
  const g = new THREE.Group();
  const p = sys.params;
  const o = { x: 0, y: 0, a: 0 };
  const v = { group: g, sys, update: () => {}, cx: 0, reach: 10 };
  const lipLine = (len) => { const s = strip(stage, kit, shadeC(P.stoneLight, 0.1), 0.09); s.scale.x = len; return s; };

  if (sys.kind === 'pier') {
    const sf = sys.surfaces[0];
    const stoneTex = kit.tex('stone' + p.style, () => paintStoneTile(61, P, p.style), { repeat: 'xy' });
    const depth = 6;
    const body = card(stage, kit, stoneTex, 1, 0, 0);
    body.geometry.dispose(); body.geometry = new THREE.PlaneGeometry(p.len, depth); body.geometry.translate(p.len / 2, -depth / 2, 0);
    body.material.map = stoneTex.clone(); body.material.map.needsUpdate = true; body.material.map.repeat.set(p.len / 2.2, depth / 2.2);
    view.clones.push(body.material.map);
    body.material.alphaMap = fadeTex(stage, kit);
    body.position.set(p.x, p.y - 0.18, -0.35);
    g.add(body);
    // cap
    const cap = strip(stage, kit, p.style === 'wood' ? P.woodLight : P.stoneLight, 0.3);
    cap.scale.x = p.len + 0.24; cap.position.set(p.x - 0.12, p.y - 0.12, -0.3);
    g.add(cap);
    const lip = lipLine(p.len); lip.position.set(p.x, p.y - 0.02, -0.28); g.add(lip);
    const under = strip(stage, kit, shadeC(P.stone, -0.45), 0.06, { opacity: 0.5 }); under.scale.x = p.len + 0.24; under.position.set(p.x - 0.12, p.y - 0.3, -0.29); g.add(under);
    // a prop or an inhabitant
    if (p.len > 3 && rng.chance(0.75)) {
      const kinds = ['lamp', 'waiter', 'pots', 'cat', 'bollard', 'sign', 'waiter'];
      const k = rng.pick(kinds);
      const t = kit.tex('prop' + k, () => paintProp(80 + kinds.indexOf(k), P, k));
      const m = card(stage, kit, t, 128 / 1.0, 64, 190);
      m.position.set(p.x + 0.5 + rng() * Math.max(0.2, p.len - 2.2), p.y, -0.2);
      g.add(m);
      if (k === 'waiter' || k === 'cat') {
        const ph = rng() * 5;
        v.wave = m;
        view.anims.push(t2 => { m.rotation.z = Math.sin(t2 * 1.2 + ph) * 0.02; });
      }
    }
    void sf;
    v.cx = p.x + p.len / 2; v.reach = p.len;
    return v;
  }

  if (sys.kind === 'skiff') {
    const t = kit.tex('skiff', () => paintSkiff(11, P));
    const m = card(stage, kit, t, 420 / p.len, 46, 88);
    g.add(m);
    const sf = sys.surfaces[0];
    v.update = tt => { sf.pose(tt, o); m.position.set(o.x, o.y, 0.02); m.rotation.z = o.a; };
    v.cx = (p.xa + p.xb) / 2 + p.len / 2; v.reach = Math.abs(p.xb - p.xa) + 4;
    // mooring posts at both ends
    for (const x of [p.xa - 0.25, p.xb + p.len + 0.15]) {
      const post = strip(stage, kit, P.woodDark, 0.18); post.position.set(x, p.y - 1.2, -0.1); post.rotation.z = Math.PI / 2; post.scale.x = 2.4; g.add(post);
    }
    return v;
  }

  if (sys.kind === 'lift') {
    const cageTex = kit.tex('cage', () => paintCage(2, P));
    const lat = kit.tex('lattice', () => paintLattice(3, P), { repeat: 'xy' });
    const pul = kit.tex('pulley', () => paintPulley(P));
    let lo = 1e9, hi = -1e9;
    for (const c of p.cages) { lo = Math.min(lo, c.yb); hi = Math.max(hi, c.yb + c.h); }
    const cages = [], ropes = [];
    const topY = hi + 3.2;
    for (const c of p.cages) {
      for (const rx of [c.x - 0.3, c.x + p.len + 0.02]) {
        const rail = card(stage, kit, lat, 1, 0, 0);
        const H = topY - lo + 10;
        rail.geometry.dispose(); rail.geometry = new THREE.PlaneGeometry(0.34, H); rail.geometry.translate(0.17, -H / 2, 0);
        rail.material.map = lat.clone(); rail.material.map.needsUpdate = true; rail.material.map.repeat.set(1, H / 0.7);
        view.clones.push(rail.material.map);
        rail.position.set(rx, topY, -0.5);
        g.add(rail);
      }
      const beam = strip(stage, kit, P.woodDark, 0.3); beam.scale.x = p.len + 0.7; beam.position.set(c.x - 0.35, topY, -0.45); g.add(beam);
      const m = card(stage, kit, cageTex, 224 / p.len, 16, 194);
      g.add(m); cages.push({ m, c });
      const r = strip(stage, kit, P.ink, 0.05); r.position.z = -0.05; g.add(r); ropes.push(r);
    }
    const pulleys = [];
    const pxs = p.cages.length > 1 ? [(p.cages[0].x + p.len + p.cages[1].x) / 2] : [p.cages[0].x + p.len / 2];
    for (const px of pxs) {
      const m = card(stage, kit, pul, 128 / 1.4, 64, 64); m.position.set(px, topY + 0.55, -0.3); g.add(m); pulleys.push(m);
    }
    if (p.cages.length > 1) { const span = strip(stage, kit, P.woodDark, 0.3); span.scale.x = p.cages[1].x - p.cages[0].x; span.position.set(p.cages[0].x + p.len / 2, topY + 0.55, -0.42); g.add(span); }
    // counterweight for a lone cage, and the operator's booth
    let cw = null;
    if (p.cages.length === 1) {
      cw = card(stage, kit, kit.tex('cw', () => paintCounterweight(P)), 128 / 0.7, 64, 20);
      cw.position.z = -0.42; g.add(cw);
    }
    const booth0 = card(stage, kit, kit.tex('booth0', () => paintBooth(91, P, false)), 256 / 2.4, 128, 240);
    const booth1 = card(stage, kit, kit.tex('booth1', () => paintBooth(91, P, true)), 256 / 2.4, 128, 240);
    const bx = p.cages[0].x - 1.6;
    for (const b of [booth0, booth1]) { b.position.set(bx, p.cages[0].yb - 0.1, -0.7); g.add(b); }
    const longK = p.pattern ? p.pattern.length - 1 : -1;
    v.update = tt => {
      const st = sys.state(tt);
      booth1.visible = st.k === longK && longK >= 0; booth0.visible = !booth1.visible;
      for (let i = 0; i < cages.length; i++) {
        sys.surfaces[i].pose(tt, o);
        cages[i].m.position.set(o.x, o.y, 0.02);
        setStrip(ropes[i], o.x + p.len / 2, o.y + 1.65, o.x + p.len / 2, topY + 0.3);
      }
      for (const m of pulleys) m.rotation.z = -st.u * 9;
      if (cw) cw.position.set(p.cages[0].x - 0.9, lo + p.cages[0].h * (1 - st.u) + 1.0, -0.42);
    };
    v.cx = p.cages[0].x + p.len; v.reach = 6;
    return v;
  }

  if (sys.kind === 'bellows') {
    const body = card(stage, kit, kit.tex('bbody', () => paintBellowsBody(4, P)), 1, 0, 0);
    body.geometry.dispose(); body.geometry = new THREE.PlaneGeometry(p.len, 1); body.geometry.translate(p.len / 2, -0.5, 0);
    const top = card(stage, kit, kit.tex('btop', () => paintBellowsTop(5, P)), 248 / p.len, 4, 6);
    const base = card(stage, kit, kit.tex('bbase', () => paintBellowsBase(6, P)), 256 / (p.len + 0.4), 0, 30);
    const baseY = p.top - p.depth - 0.9;
    base.position.set(p.x - 0.2, baseY, -0.1);
    g.add(body); g.add(top); g.add(base);
    v.update = tt => {
      const st = sys.state(tt);
      const y = p.top - p.depth * st.squeeze;
      top.position.set(p.x, y, 0.03);
      const h = Math.max(0.1, y - 0.25 - baseY);
      body.position.set(p.x, y - 0.25, -0.02); body.scale.y = h;
    };
    v.cx = p.x + 1; v.reach = 4;
    return v;
  }

  if (sys.kind === 'wheel') {
    const wt = kit.tex('wheel', () => paintWheel(8, P));
    const wheel = card(stage, kit, wt, 481 / p.R, 512, 512);
    wheel.position.set(p.cx, p.cy, -0.35);
    const stand = card(stage, kit, kit.tex('wstand', () => paintWheelStand(9, P)), 1024 / (p.R + 12), 256, 112);
    stand.position.set(p.cx, p.cy, -0.5);
    g.add(stand); g.add(wheel);
    const gt = [kit.tex('gond0', () => paintGondola(0, P)), kit.tex('gond1', () => paintGondola(1, P))];
    const gons = sys.surfaces.map((sf, i) => { const m = card(stage, kit, gt[i % 2], 212 / sf.len, 22, 189); g.add(m); return m; });
    const hangers = sys.surfaces.map(() => { const s = strip(stage, kit, P.woodDark, 0.06); s.position.z = -0.1; g.add(s); return s; });
    v.update = tt => {
      const a = sys.angleAt(tt);
      wheel.rotation.z = a;
      sys.surfaces.forEach((sf, i) => {
        sf.pose(tt, o);
        gons[i].position.set(o.x, o.y, 0.02);
        const ph = a + i * TAU / p.n;
        setStrip(hangers[i], p.cx + Math.cos(ph) * p.R, p.cy + Math.sin(ph) * p.R, o.x + sf.len / 2, o.y + 1.0);
      });
    };
    v.cx = p.cx; v.reach = p.R + 4;
    return v;
  }

  if (sys.kind === 'swing') {
    const crane = card(stage, kit, kit.tex('crane', () => paintCrane(12, P)), 70, 420, 122);
    crane.position.set(p.px, p.py, -0.45);
    g.add(crane);
    const rope = strip(stage, kit, P.ink, 0.05); rope.position.z = -0.05; g.add(rope);
    const ring = card(stage, kit, kit.tex('ring', () => paintRing(P)), 128 / 0.75, 64, 64);
    g.add(ring);
    const h = sys.handles[0];
    v.update = tt => {
      h.pos(tt, o);
      setStrip(rope, p.px, p.py, o.x, o.y + 0.25);
      ring.position.set(o.x, o.y, 0.08);
    };
    v.ring = ring;
    v.cx = p.px; v.reach = p.L + 4;
    return v;
  }

  if (sys.kind === 'trolley') {
    const wh = kit.tex('wheelhouse', () => paintWheelhouse(13, P));
    for (const [x, y] of [[p.ax, p.ay], [p.bx, p.by]]) { const m = card(stage, kit, wh, 128 / 1.0, 128, 120); m.position.set(x, y, -0.4); g.add(m); }
    const cable = strip(stage, kit, P.ink, 0.045); cable.position.z = -0.1; setStrip(cable, p.ax, p.ay, p.bx, p.by); g.add(cable);
    const cable2 = strip(stage, kit, P.ink, 0.035, { opacity: 0.6 }); cable2.position.z = -0.12; setStrip(cable2, p.ax, p.ay + 0.25, p.bx, p.by + 0.25); g.add(cable2);
    const trT = kit.tex('trolley', () => paintTrolley(P));
    const ringT = kit.tex('ring', () => paintRing(P));
    const items = sys.handles.map(() => {
      const tr = card(stage, kit, trT, 128 / 0.8, 64, 30); const ring = card(stage, kit, ringT, 128 / 0.75, 64, 64);
      g.add(tr); g.add(ring); return { tr, ring };
    });
    v.update = tt => {
      sys.handles.forEach((h, i) => {
        const vis = h.pos(tt, o);
        items[i].tr.visible = items[i].ring.visible = vis;
        if (vis) { items[i].ring.position.set(o.x, o.y, 0.08); items[i].tr.position.set(o.x, o.y + 0.55, 0.06); }
      });
    };
    v.cx = (p.ax + p.bx) / 2; v.reach = Math.abs(p.bx - p.ax) / 2 + 4;
    return v;
  }

  if (sys.kind === 'strider' || sys.kind === 'walker') {
    const goal = sys.kind === 'walker';
    const sc = goal ? 1.6 : 1;
    const bodyT = kit.tex(goal ? 'walkerBody' : 'striderBody', () => paintStriderBody(goal ? 17 : 14, P, goal));
    const body = card(stage, kit, bodyT, 328 / p.len, 92, 60);
    g.add(body);
    let house = null;
    if (goal) {
      house = card(stage, kit, kit.tex('walkerHouse', () => paintWalkerHouse(19, P, kit.region === 3)), 468 / p.len, 22, 430);
      g.add(house);
    }
    const legCol = mixC(P.leafDark, P.ink, goal ? 0.6 : 0.45);
    const legs = [];
    for (let l = 0; l < 4; l++) {
      const near = l >= 2;
      const th = strip(stage, kit, near ? legCol : shadeC(legCol, -0.25), 0.2 * sc), sh = strip(stage, kit, near ? legCol : shadeC(legCol, -0.25), 0.14 * sc);
      th.position.z = sh.position.z = near ? 0.22 : -0.15;
      g.add(th); g.add(sh); legs.push([th, sh]);
    }
    const sf = sys.surfaces[0];
    const legLen = 3.6 * sc;
    v.update = tt => {
      const st = sys.state(tt);
      sf.pose(tt, o);
      body.position.set(o.x, o.y, house ? -0.04 : 0.02); body.rotation.z = o.a;
      body.scale.x = st.dir < 0 && !goal ? 1 : 1;
      if (house) { house.position.set(o.x, o.y, -0.02); house.rotation.z = o.a; }
      const hipY = o.y - 0.9 * sc;
      for (let l = 0; l < 4; l++) {
        const front = l % 2 === 0;
        const hipX = o.x + (front ? p.len * 0.78 : p.len * 0.22);
        const ph = st.stepPh * Math.PI + (l === 0 || l === 3 ? 0 : Math.PI);
        const swing = st.moving ? Math.sin(ph) * 0.9 * sc : 0;
        const lift = st.moving ? Math.max(0, Math.cos(ph)) * 0.5 * sc : 0;
        const fx = hipX + swing * st.dir, fy = hipY - legLen * 2 * 0.92 + lift;
        const kx = (hipX + fx) / 2 + 0.6 * sc * (front ? 1 : -1) * 0.6, ky = (hipY + fy) / 2 + 0.3;
        setStrip(legs[l][0], hipX, hipY, kx, ky);
        setStrip(legs[l][1], kx, ky, fx, fy);
      }
    };
    v.cx = (p.xa + p.xb) / 2; v.reach = Math.abs(p.xb - p.xa) / 2 + 6;
    return v;
  }
  return null;
}

// Shared alpha ramp: opaque at the top, gone at the bottom.
function fadeTex(stage, kit) {
  if (!kit.fadeTex) {
    const c = cv(4, 64), gg = c.getContext('2d');
    const lg = gg.createLinearGradient(0, 0, 0, 64); lg.addColorStop(0, '#fff'); lg.addColorStop(0.5, '#fff'); lg.addColorStop(1, '#000');
    gg.fillStyle = lg; gg.fillRect(0, 0, 4, 64);
    kit.fadeTex = new stage.THREE.CanvasTexture(c); kit.cache.set('fade', kit.fadeTex);
  }
  return kit.fadeTex;
}
