// World: materials, level meshes, doors, lights, collision, line of sight and pathfinding.
const MAT = {};
let scene = null, camera = null, renderer = null, gunScene = null, gunCam = null;
let envTex = null;
let L = null;
let levelGroup = null;
let exitOpen = false;
const doors = {};
let propBoxes = [];
let propGrid = null;
let fixtures = null, fixtureList = [];
const poolLights = [];
let exitLight = null, exitIndicator = null;
let decals = null;
let flow = null, flowCell = -1, exitFlow = null;
let navField = null, navKey = -1;

function buildMaterials() {
  const std = (o) => new THREE.MeshStandardMaterial(o);
  MAT.floor = std({ map: TEX.floor, bumpMap: TEX.floor, bumpScale: 1.2, roughnessMap: TEX.floorRough, roughness: 0.95, metalness: 0 });
  MAT.wall = std({ map: TEX.wall, bumpMap: TEX.wall, bumpScale: 1.0, roughness: 0.93 });
  MAT.ceil = std({ map: TEX.ceil, bumpMap: TEX.ceil, bumpScale: 0.8, roughness: 1 });
  MAT.steel = std({ map: TEX.steel, color: 0x6a6e72, roughness: 0.45, metalness: 0.75, envMap: envTex, envMapIntensity: 0.35 });
  MAT.steelDark = std({ map: TEX.steel, color: 0x4a4f54, roughness: 0.5, metalness: 0.7, envMap: envTex, envMapIntensity: 0.5 });
  MAT.crate = std({ map: TEX.crate, bumpMap: TEX.crate, bumpScale: 1, roughness: 0.85 });
  MAT.barrel = std({ map: TEX.barrel, roughness: 0.55, metalness: 0.45, envMap: envTex, envMapIntensity: 0.4 });
  MAT.desk = std({ map: TEX.steel, color: 0x60665e, roughness: 0.55, metalness: 0.5, envMap: envTex, envMapIntensity: 0.4 });
  MAT.cabinet = std({ map: TEX.steel, color: 0x6e7766, roughness: 0.5, metalness: 0.55, envMap: envTex, envMapIntensity: 0.4 });
  MAT.pipe = std({ map: TEX.steel, color: 0x7a5136, roughness: 0.45, metalness: 0.7, envMap: envTex, envMapIntensity: 0.5 });
  MAT.fixture = new THREE.MeshBasicMaterial({ color: 0xffffff });
  MAT.red = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.15, 0.1) });
  MAT.green = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 3, 0.4) });
  MAT.blood = TEX.blood.map(t => std({ map: t, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 0.3, metalness: 0 }));
  MAT.hole = std({ map: TEX.hole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6, roughness: 1 });
  MAT.scorch = std({ map: TEX.hole, color: 0x222222, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -5, roughness: 1, opacity: 0.85 });
}

function buildEnvironment() {
  // A tiny dim room of light panels so metal has something to reflect.
  const es = new THREE.Scene();
  const box = new THREE.Mesh(new THREE.BoxGeometry(10, 6, 10), new THREE.MeshBasicMaterial({ color: 0x15161a, side: THREE.BackSide }));
  es.add(box);
  const panel = (x, y, z, w, h, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); es.add(m); };
  panel(0, 2.9, 0, 3, 0.8, 0xfff2dd); panel(4.9, 1, 1, 1.5, 2, 0x8899aa); panel(-4.9, 0.5, -2, 2, 1, 0x554433); panel(0, 1, 4.9, 3, 1, 0x667788);
  const pm = new THREE.PMREMGenerator(renderer);
  envTex = pm.fromScene(es, 0.04).texture;
  pm.dispose();
}

function geoB() { return { p: [], n: [], u: [], i: [] }; }
function quad(gb, a, b, c, d, n, uv) {
  const base = gb.p.length / 3;
  gb.p.push(...a, ...b, ...c, ...d);
  for (let k = 0; k < 4; k++) gb.n.push(n[0], n[1], n[2]);
  gb.u.push(...uv);
  gb.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
}
function toGeo(gb) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(gb.p, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(gb.n, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(gb.u, 2));
  geo.setIndex(gb.i);
  geo.computeBoundingSphere();
  return geo;
}
const hash2 = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

function disposeLevel() {
  if (!levelGroup) return;
  levelGroup.traverse(o => {
    if (o.geometry && !o.userData.sharedGeo) o.geometry.dispose();
    if (o.isInstancedMesh) o.dispose();
    if (o.userData.ownMat) o.material.dispose();
    if (o.userData.dispose) o.userData.dispose();
  });
  scene.remove(levelGroup);
  levelGroup = null;
}

const sharedGeo = {};
function getSharedGeo() {
  if (sharedGeo.box) return sharedGeo;
  sharedGeo.box = new THREE.BoxGeometry(1, 1, 1);
  sharedGeo.barrel = new THREE.CylinderGeometry(0.31, 0.31, 0.95, 16);
  sharedGeo.pipe = new THREE.CylinderGeometry(0.075, 0.075, 1, 10);
  sharedGeo.plane = new THREE.PlaneGeometry(1, 1);
  sharedGeo.fixture = new THREE.BoxGeometry(1.25, 0.05, 0.24);
  return sharedGeo;
}

function addBox(x0, z0, x1, z1, h = 3, on = true) {
  const b = { x0, z0, x1, z1, h, on };
  propBoxes.push(b);
  const N = L.N;
  for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) {
    if (i < 0 || j < 0 || i >= N || j >= N) continue;
    (propGrid[j * N + i] || (propGrid[j * N + i] = [])).push(b);
  }
  return b;
}

function buildLevel(Ld) {
  disposeLevel();
  L = Ld; exitOpen = false;
  propBoxes = []; propGrid = new Array(L.N * L.N);
  const G = getSharedGeo();
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  const N = L.N, g = L.g;
  const gb = { floor: geoB(), ceil: geoB(), wall: geoB(), steel: geoB() };
  const solidAt = (i, j) => (i < 0 || j < 0 || i >= N || j >= N) ? true : g[j * N + i] === 0;
  const pipes = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const v = g[j * N + i]; if (v === 0) continue;
    const x0 = i * CELL, x1 = x0 + CELL, z0 = j * CELL, z1 = z0 + CELL;
    const elev = v >= 2;
    const uvF = [x0 / CELL, z0 / CELL, x0 / CELL, z1 / CELL, x1 / CELL, z1 / CELL, x1 / CELL, z0 / CELL];
    quad(elev ? gb.steel : gb.floor, [x0, 0, z0], [x0, 0, z1], [x1, 0, z1], [x1, 0, z0], [0, 1, 0], uvF);
    quad(elev ? gb.steel : gb.ceil, [x0, WALL_H, z0], [x1, WALL_H, z0], [x1, WALL_H, z1], [x0, WALL_H, z1], [0, -1, 0], [x0 / CELL, z0 / CELL, x1 / CELL, z0 / CELL, x1 / CELL, z1 / CELL, x0 / CELL, z1 / CELL]);
    for (let d = 0; d < 4; d++) {
      const [dx, dy] = DIR4[d];
      if (!solidAt(i + dx, j + dy)) continue;
      let p, q;
      if (dx === 1) { p = [x1, z0]; q = [x1, z1]; }
      else if (dx === -1) { p = [x0, z1]; q = [x0, z0]; }
      else if (dy === 1) { p = [x1, z1]; q = [x0, z1]; }
      else { p = [x0, z0]; q = [x1, z0]; }
      const u0 = hash2(i, j, d) < 0.5 ? 0 : 0.5, u1 = u0 + 0.5;
      quad(elev ? gb.steel : gb.wall, [p[0], 0, p[1]], [q[0], 0, q[1]], [q[0], WALL_H, q[1]], [p[0], WALL_H, p[1]], [-dx, 0, -dy], [u0, 0, u1, 0, u1, 1, u0, 1]);
      if (!elev && hash2(i, j, d + 9) < 0.14) pipes.push({ x: (p[0] + q[0]) / 2 - dx * 0.2, z: (p[1] + q[1]) / 2 - dy * 0.2, alongX: dy !== 0 });
    }
  }
  const mkMesh = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.matrixAutoUpdate = false; m.updateMatrix(); levelGroup.add(m); return m; };
  mkMesh(toGeo(gb.floor), MAT.floor);
  mkMesh(toGeo(gb.ceil), MAT.ceil);
  mkMesh(toGeo(gb.wall), MAT.wall);
  mkMesh(toGeo(gb.steel), MAT.steel);

  // Pipes along the top of some walls.
  if (pipes.length) {
    const im = new THREE.InstancedMesh(G.pipe, MAT.pipe, pipes.length * 2);
    im.userData.sharedGeo = true;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3();
    let k = 0;
    for (const pp of pipes) {
      q.setFromEuler(new THREE.Euler(pp.alongX ? 0 : Math.PI / 2, 0, pp.alongX ? Math.PI / 2 : 0));
      s.set(1, CELL, 1);
      pos.set(pp.x, 2.74, pp.z); m4.compose(pos, q, s); im.setMatrixAt(k++, m4);
      pos.set(pp.x, 2.56, pp.z); s.set(0.7, CELL, 0.7); m4.compose(pos, q, s); im.setMatrixAt(k++, m4);
    }
    levelGroup.add(im);
  }

  // Props.
  const byType = { crate: [], barrel: [], desk: [], cabinet: [] };
  for (const pr of L.props) byType[pr.type].push(pr);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), pos = new THREE.Vector3(), eu = new THREE.Euler();
  const inst = (geo, mat, list, fn) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    im.userData.sharedGeo = true;
    list.forEach((it, k) => { fn(it); m4.compose(pos, q, s); im.setMatrixAt(k, m4); });
    levelGroup.add(im);
  };
  inst(G.box, MAT.crate, byType.crate, (p) => { eu.set(0, p.rotY, 0); q.setFromEuler(eu); s.set(p.dims[0], p.dims[1], p.dims[2]); pos.set(p.x, (p.y || 0) + p.dims[1] / 2, p.z); });
  inst(G.barrel, MAT.barrel, byType.barrel, (p) => { eu.set(0, p.rotY + p.x, 0); q.setFromEuler(eu); s.set(1, 1, 1); pos.set(p.x, 0.475, p.z); });
  inst(G.box, MAT.cabinet, byType.cabinet, (p) => { eu.set(0, p.rotY, 0); q.setFromEuler(eu); s.set(p.dims[0], p.dims[1], p.dims[2]); pos.set(p.x, p.dims[1] / 2, p.z); });
  inst(G.box, MAT.desk, byType.desk, (p) => { eu.set(0, p.rotY, 0); q.setFromEuler(eu); s.set(1.5, 0.05, 0.75); pos.set(p.x, 0.76, p.z); });
  const legs = [];
  for (const p of byType.desk) for (const [a, b] of [[-0.7, -0.33], [0.7, -0.33], [-0.7, 0.33], [0.7, 0.33]]) {
    const c = Math.cos(p.rotY), sn = Math.sin(p.rotY);
    legs.push({ x: p.x + a * c + b * sn, z: p.z - a * sn + b * c, rotY: p.rotY });
  }
  inst(G.box, MAT.desk, legs, (p) => { eu.set(0, p.rotY, 0); q.setFromEuler(eu); s.set(0.05, 0.74, 0.05); pos.set(p.x, 0.37, p.z); });
  for (const p of L.props) if (!p.stacked) addBox(p.x - p.hx, p.z - p.hz, p.x + p.hx, p.z + p.hz, p.dims[1] + (p.type === 'crate' ? 0.6 : 0));

  // Ceiling fixtures (also lit inside elevators).
  fixtureList = L.lights.slice();
  for (const e of [L.start, L.exit].filter(Boolean)) fixtureList.push({ x: (e.ex + 0.5) * CELL, z: (e.ey + 0.5) * CELL, state: 'dim', color: 0xe8f0ff, rot: 0, phase: 0, elev: true });
  fixtures = new THREE.InstancedMesh(G.fixture, MAT.fixture, fixtureList.length);
  fixtures.userData.sharedGeo = true;
  const col = new THREE.Color();
  fixtureList.forEach((f, k) => {
    eu.set(0, f.rot, 0); q.setFromEuler(eu); s.set(1, 1, 1); pos.set(f.x, WALL_H - 0.026, f.z);
    m4.compose(pos, q, s); fixtures.setMatrixAt(k, m4);
    col.set(f.color).multiplyScalar(f.state === 'off' ? 0.04 : 2.6);
    fixtures.setColorAt(k, col);
    f.level = f.state === 'off' ? 0 : f.state === 'dim' ? 0.25 : 1;
  });
  levelGroup.add(fixtures);

  buildElevator('start', L.start);
  if (L.exit) buildElevator('exit', L.exit);
  else { doors.exit = null; if (exitLight) exitLight.intensity = 0; }

  // Decals: static blood first, the rest of each ring is for gunfire.
  decals = { blood: [], hole: null, scorch: null, bNext: [0, 0, 0], bStart: [0, 0, 0], hNext: 0, sNext: 0 };
  for (let v = 0; v < 3; v++) { const im = new THREE.InstancedMesh(G.plane, MAT.blood[v], 70); im.count = 0; im.frustumCulled = false; im.userData.sharedGeo = true; levelGroup.add(im); decals.blood.push(im); }
  decals.hole = new THREE.InstancedMesh(G.plane, MAT.hole, 90); decals.hole.count = 0; decals.hole.frustumCulled = false; decals.hole.userData.sharedGeo = true; levelGroup.add(decals.hole);
  decals.scorch = new THREE.InstancedMesh(G.plane, MAT.scorch, 16); decals.scorch.count = 0; decals.scorch.frustumCulled = false; decals.scorch.userData.sharedGeo = true; levelGroup.add(decals.scorch);
  for (const d of L.decals) {
    if (d.wall) addDecal('blood', d.x, d.y, d.z, d.nx, 0, d.nz, d.s, d.r, d.v, true);
    else addDecal('blood', d.x, 0, d.z, 0, 1, 0, d.s, d.r, d.v, true);
  }
  for (let v = 0; v < 3; v++) decals.bStart[v] = decals.bNext[v];

  exitFlow = L.exit ? bfsFrom(L.exit.rx, L.exit.ry) : null;
  navField = null; navKey = -1;
  flow = null; flowCell = -1;
}

let _dm, _dq, _dq2, _dv, _ds, _dz, _dn;
function initWorldTemps() { _dm = new THREE.Matrix4(); _dq = new THREE.Quaternion(); _dq2 = new THREE.Quaternion(); _dv = new THREE.Vector3(); _ds = new THREE.Vector3(); _dz = new THREE.Vector3(0, 0, 1); _dn = new THREE.Vector3(); }
function addDecal(kind, x, y, z, nx, ny, nz, size, rot, variant = 0, isStatic = false) {
  if (!decals) return;
  let im, idx;
  if (kind === 'blood') {
    im = decals.blood[variant];
    const cap = im.instanceMatrix.count;
    if (decals.bNext[variant] >= cap) decals.bNext[variant] = decals.bStart[variant];
    if (decals.bStart[variant] >= cap - 4 && !isStatic) return;
    idx = decals.bNext[variant]++;
  } else if (kind === 'hole') {
    im = decals.hole; if (decals.hNext >= im.instanceMatrix.count) decals.hNext = 0; idx = decals.hNext++;
  } else {
    im = decals.scorch; if (decals.sNext >= im.instanceMatrix.count) decals.sNext = 0; idx = decals.sNext++;
  }
  _dn.set(nx, ny, nz);
  _dq.setFromUnitVectors(_dz, _dn);
  _dq2.setFromAxisAngle(_dn, rot);
  _dq.premultiply(_dq2);
  const off = kind === 'hole' ? 0.006 : 0.004 + Math.random() * 0.003;
  _dv.set(x + nx * off, y + ny * off, z + nz * off);
  _ds.set(size, size, size);
  _dm.compose(_dv, _dq, _ds);
  im.setMatrixAt(idx, _dm);
  im.count = Math.max(im.count, idx + 1);
  im.instanceMatrix.needsUpdate = true;
}

function buildElevator(which, e) {
  const G = getSharedGeo();
  const dx = e.dx, dy = e.dy;
  const bx = (e.rx + 0.5) * CELL + dx * CELL / 2, bz = (e.ry + 0.5) * CELL + dy * CELL / 2;
  const ax = dx !== 0 ? 0 : 1, az = dx !== 0 ? 1 : 0; // axis along the door
  const OPEN_W = 1.8, JAMB = (CELL - OPEN_W) / 2, DOOR_H = 2.3, T = 0.24;
  const grp = new THREE.Group();
  const box = (cx, cy, cz, sx, sy, sz, mat) => { const m = new THREE.Mesh(G.box, mat); m.position.set(cx, cy, cz); m.scale.set(sx, sy, sz); m.userData.sharedGeo = true; grp.add(m); return m; };
  const along = (d) => [bx + ax * d, bz + az * d];
  const size = (l, t) => (ax ? [l, t] : [t, l]);
  for (const sgn of [-1, 1]) {
    const [cx, cz] = along(sgn * (OPEN_W / 2 + JAMB / 2));
    const [sx, sz] = size(JAMB, T);
    box(cx, WALL_H / 2, cz, sx, WALL_H, sz, MAT.steelDark);
    addBox(cx - sx / 2, cz - sz / 2, cx + sx / 2, cz + sz / 2);
  }
  { const [sx, sz] = size(OPEN_W, T); box(bx, (DOOR_H + WALL_H) / 2, bz, sx, WALL_H - DOOR_H, sz, MAT.steelDark); }
  const panels = [];
  for (const sgn of [-1, 1]) {
    const [sx, sz] = size(OPEN_W / 2 - 0.01, 0.07);
    const m = box(0, DOOR_H / 2, 0, sx, DOOR_H, sz, MAT.steel);
    panels.push({ m, sgn });
  }
  const blocker = addBox(bx - (ax ? OPEN_W / 2 : 0.12), bz - (az ? OPEN_W / 2 : 0.12), bx + (ax ? OPEN_W / 2 : 0.12), bz + (az ? OPEN_W / 2 : 0.12));
  const roomSide = -1; // the room is at -d from the boundary
  const ix = bx + dx * roomSide * (T / 2 + 0.02), iz = bz + dy * roomSide * (T / 2 + 0.02);
  if (which === 'start') {
    const tex = floorSignTexture(L.floor);
    const sm = new THREE.MeshBasicMaterial({ map: tex, color: 0x8a8a8a });
    const sign = new THREE.Mesh(G.plane, sm);
    sign.userData.sharedGeo = true; sign.userData.ownMat = true;
    sign.scale.set(1.5, 0.47, 1);
    sign.position.set(ix, (DOOR_H + WALL_H) / 2, iz);
    sign.lookAt(ix - dx, (DOOR_H + WALL_H) / 2, iz - dy);
    grp.add(sign);
    sign.userData.dispose = () => tex.dispose();
  } else {
    const ind = box(ix, (DOOR_H + WALL_H) / 2, iz, ax ? 1.2 : 0.04, 0.1, ax ? 0.04 : 1.2, MAT.red);
    exitIndicator = ind;
    if (!exitLight) { exitLight = new THREE.PointLight(0xff2010, 0, 7, 2); scene.add(exitLight); }
    exitLight.color.setRGB(1, 0.12, 0.06);
    exitLight.intensity = 2.2;
    exitLight.position.set(bx - dx * 0.8, 2.4, bz - dy * 0.8);
  }
  levelGroup.add(grp);
  doors[which] = { panels, blocker, open: 0, target: 0, bx, bz, ax, az, dx, dy, OPEN_W };
  updateDoor(doors[which], 0);
}
function updateDoor(d, dt) {
  d.open = d.target > d.open ? Math.min(d.target, d.open + dt * 0.9) : Math.max(d.target, d.open - dt * 0.9);
  const slide = 0.46 + d.open * 0.9;
  for (const p of d.panels) {
    const off = p.sgn * slide;
    p.m.position.set(d.bx + d.ax * off + d.dx * 0.06, p.m.position.y, d.bz + d.az * off + d.dy * 0.06);
  }
  d.blocker.on = d.open < 0.85;
}
function setExitOpen() {
  if (exitOpen || !doors.exit) return;
  exitOpen = true;
  doors.exit.target = 1;
  if (exitIndicator) exitIndicator.material = MAT.green;
  if (exitLight) exitLight.color.setRGB(0.15, 1, 0.3);
}

// ---------- collision ----------
function cellOf(x) { return Math.floor(x / CELL); }
function solidFor(i, j, forPlayer) {
  if (!L || i < 0 || j < 0 || i >= L.N || j >= L.N) return true;
  const v = L.g[j * L.N + i];
  if (v === 0) return true;
  if (v === 1) return false;
  if (!forPlayer) return true;
  if (v === 3) return !exitOpen;
  return false;
}
function pushOutAABB(e, r, x0, z0, x1, z1) {
  const cx = clamp(e.x, x0, x1), cz = clamp(e.z, z0, z1);
  const dx = e.x - cx, dz = e.z - cz, d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return false;
  if (d2 > 1e-9) { const d = Math.sqrt(d2), k = (r - d) / d; e.x += dx * k; e.z += dz * k; }
  else {
    const l = e.x - x0, rr = x1 - e.x, t = e.z - z0, b = z1 - e.z, m = Math.min(l, rr, t, b);
    if (m === l) e.x = x0 - r; else if (m === rr) e.x = x1 + r; else if (m === t) e.z = z0 - r; else e.z = z1 + r;
  }
  return true;
}
function collide(e, r, forPlayer) {
  let hit = false;
  for (let pass = 0; pass < 2; pass++) {
    const ci = cellOf(e.x), cj = cellOf(e.z);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      if (solidFor(i, j, forPlayer)) { if (pushOutAABB(e, r, i * CELL, j * CELL, (i + 1) * CELL, (j + 1) * CELL)) hit = true; }
      if (i < 0 || j < 0 || i >= L.N || j >= L.N) continue;
      const list = propGrid[j * L.N + i];
      if (list) for (const b of list) if (b.on && pushOutAABB(e, r, b.x0, b.z0, b.x1, b.z1)) hit = true;
    }
  }
  return hit;
}

// ---------- rays ----------
function raySolid(i, j) {
  if (i < 0 || j < 0 || i >= L.N || j >= L.N) return true;
  const v = L.g[j * L.N + i];
  return v === 0 || (v === 3 && !exitOpen);
}
// Horizontal DDA through the grid. Returns {t, nx, nz} or null within maxT.
function gridRay(ox, oz, hx, hz, maxT) {
  let i = cellOf(ox), j = cellOf(oz);
  const si = hx > 0 ? 1 : -1, sj = hz > 0 ? 1 : -1;
  const tdx = Math.abs(hx) > 1e-9 ? Math.abs(CELL / hx) : Infinity, tdz = Math.abs(hz) > 1e-9 ? Math.abs(CELL / hz) : Infinity;
  let tmx = Math.abs(hx) > 1e-9 ? ((hx > 0 ? (i + 1) * CELL : i * CELL) - ox) / hx : Infinity;
  let tmz = Math.abs(hz) > 1e-9 ? ((hz > 0 ? (j + 1) * CELL : j * CELL) - oz) / hz : Infinity;
  for (let n = 0; n < 256; n++) {
    let t, nx = 0, nz = 0;
    if (tmx < tmz) { t = tmx; i += si; tmx += tdx; nx = -si; } else { t = tmz; j += sj; tmz += tdz; nz = -sj; }
    if (t > maxT) return null;
    if (raySolid(i, j)) return { t, nx, nz };
  }
  return null;
}
function losClear(x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  return !gridRay(x0, z0, dx / d, dz / d, d);
}
// Full 3D ray against walls, floor, ceiling and props.
const _rh = { t: 0, nx: 0, ny: 0, nz: 0, prop: false };
function rayWorld(ox, oy, oz, dx, dy, dz, maxD) {
  let best = maxD, nx = 0, ny = 0, nz = 0, prop = false;
  if (dy < -1e-6) { const t = -oy / dy; if (t < best) { best = t; nx = 0; ny = 1; nz = 0; } }
  if (dy > 1e-6) { const t = (WALL_H - oy) / dy; if (t < best) { best = t; nx = 0; ny = -1; nz = 0; } }
  const h = Math.hypot(dx, dz);
  if (h > 1e-6) {
    const w = gridRay(ox, oz, dx / h, dz / h, best * h);
    if (w && w.t / h < best) { best = w.t / h; nx = w.nx; ny = 0; nz = w.nz; }
  }
  for (const b of propBoxes) {
    if (!b.on) continue;
    // slab test
    let t0 = 0, t1 = best, ax = 0, axs = 0;
    const sl = (o, d, lo, hi, axis) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let a = (lo - o) / d, c = (hi - o) / d, s = -1;
      if (a > c) { const tmp = a; a = c; c = tmp; s = 1; }
      if (a > t0) { t0 = a; ax = axis; axs = s; }
      if (c < t1) t1 = c;
      return t0 <= t1;
    };
    if (sl(ox, dx, b.x0, b.x1, 1) && sl(oy, dy, 0, b.h, 2) && sl(oz, dz, b.z0, b.z1, 3) && t0 > 0.01 && t0 < best) {
      best = t0; prop = true;
      nx = ax === 1 ? axs : 0; ny = ax === 2 ? axs : 0; nz = ax === 3 ? axs : 0;
      if (ax === 0) ny = 1;
    }
  }
  _rh.t = best; _rh.nx = nx; _rh.ny = ny; _rh.nz = nz; _rh.prop = prop;
  return _rh;
}

// ---------- pathfinding ----------
function bfsFrom(si, sj) {
  const N = L.N, d = new Int16Array(N * N).fill(-1);
  if (si < 0 || sj < 0 || si >= N || sj >= N || L.g[sj * N + si] !== 1) return d;
  const q = new Int32Array(N * N); let qh = 0, qt = 0;
  q[qt++] = sj * N + si; d[sj * N + si] = 0;
  while (qh < qt) {
    const k = q[qh++], x = k % N, y = (k / N) | 0;
    for (let n = 0; n < 4; n++) {
      const nx = x + DIR4[n][0], ny = y + DIR4[n][1];
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const nk = ny * N + nx;
      if (L.g[nk] === 1 && d[nk] < 0) { d[nk] = d[k] + 1; q[qt++] = nk; }
    }
  }
  return d;
}
function updateFlow() {
  let i = cellOf(P.x), j = cellOf(P.z);
  const v = (i >= 0 && j >= 0 && i < L.N && j < L.N) ? L.g[j * L.N + i] : 0;
  if (v === 2) { i = L.start.rx; j = L.start.ry; }
  else if (v === 3 && L.exit) { i = L.exit.rx; j = L.exit.ry; }
  else if (v !== 1) return;
  const k = j * L.N + i;
  if (k === flowCell && flow) return;
  flowCell = k;
  flow = bfsFrom(i, j);
}
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
// Next waypoint for a walker following a distance field toward its source.
function flowStep(field, x, z, out) {
  const N = L.N, i = cellOf(x), j = cellOf(z);
  const walk = (a, b) => a >= 0 && b >= 0 && a < N && b < N && L.g[b * N + a] === 1 && field[b * N + a] >= 0;
  if (!walk(i, j)) {
    // Off the walkable grid (e.g. inside an elevator): step to the best open neighbour.
    let bd = 1e9, bi = i, bj = j;
    for (const [di, dj] of DIR4) { const ni = i + di, nj = j + dj; if (walk(ni, nj) && field[nj * N + ni] < bd) { bd = field[nj * N + ni]; bi = ni; bj = nj; } }
    out.x = (bi + 0.5) * CELL; out.z = (bj + 0.5) * CELL; return bi !== i || bj !== j;
  }
  let best = field[j * N + i], bi = i, bj = j;
  for (const [di, dj] of DIR8) {
    const ni = i + di, nj = j + dj;
    if (!walk(ni, nj)) continue;
    if (di && dj && !(walk(i + di, j) && walk(i, j + dj))) continue;
    const dv = field[nj * N + ni] + (di && dj ? 0.5 : 0);
    if (dv < best) { best = dv; bi = ni; bj = nj; }
  }
  out.x = (bi + 0.5) * CELL; out.z = (bj + 0.5) * CELL;
  return bi !== i || bj !== j;
}

// Path field toward an arbitrary point (weapon crate, nearest ammo), cached by target cell.
function navTo(x, z) {
  const i = cellOf(x), j = cellOf(z), key = j * L.N + i;
  if (key !== navKey || !navField) { navKey = key; navField = bfsFrom(i, j); }
  return navField;
}
