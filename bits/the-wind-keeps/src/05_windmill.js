// WORLD I — THE WINDMILL
// Wind arrives from the meadow on the left. Catch it in the sails; the rotor's
// momentum drives a pump that fills a cistern; the cistern feeds a water wheel;
// the wheel's cam kicks a ratchet lift; the lift carries a small lantern-bearer
// to a greenhouse on the cliff, where its seed becomes a flower and a bell rings.
function waterMaterial(THREE, o = {}) {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      cDeep: { value: new THREE.Color(o.deep || 0x4f9fa6) }, cLight: { value: new THREE.Color(o.light || 0x8fd0cc) }, cFoam: { value: new THREE.Color(o.foam || 0xf2f6ee) },
      uT: { value: 0 }, uSpeed: { value: o.speed || 1 }, uOp: { value: o.opacity ?? 0.92 }, uScale: { value: o.scale || 4 }, uFlow: { value: 1 }
    }]),
    transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv;
      #include <fog_pars_vertex>
      void main(){ vUv = uv; vec4 mvPosition = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
      }`,
    fragmentShader: `uniform vec3 cDeep, cLight, cFoam; uniform float uT, uSpeed, uOp, uScale, uFlow; varying vec2 vUv;
      #include <fog_pars_fragment>
      void main(){
        float x = vUv.x * uScale - uT * uSpeed * uFlow;
        float wob = sin(vUv.y * 9.0 + uT * 1.3) * 0.15;
        float s1 = sin((x + wob) * 6.2831);
        float s2 = sin((x * 2.3 - wob) * 6.2831 + 1.7);
        float band = smoothstep(0.72, 1.0, s1) * (0.4 + 0.6 * uFlow) + smoothstep(0.85, 1.0, s2) * 0.5 * uFlow;
        float edge = smoothstep(0.32, 0.5, abs(vUv.y - 0.5));
        vec3 c = mix(cDeep, cLight, 0.5 + 0.35 * sin(x * 3.1 + vUv.y * 4.0));
        c = mix(c, cFoam, clamp(band * 0.6 + edge * 0.45, 0.0, 1.0));
        gl_FragColor = vec4(c, uOp * (1.0 - smoothstep(0.46, 0.5, abs(vUv.y - 0.5)) * 0.5));
        #include <fog_fragment>
      }`
  });
}
// a strip along a polyline, lying in a plane: 'flat' (XZ, for streams) or 'vert' (facing +z, for falls)
function stripGeo(THREE, pts, width, mode = 'flat', seg = 2) {
  const curve = new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p)));
  const n = Math.max(2, Math.ceil(curve.getLength() * seg));
  const pos = [], uv = [], idx = [], _t = new THREE.Vector3(), _s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(0, 0, 1);
  const L = curve.getLength();
  for (let i = 0; i <= n; i++) {
    const u = i / n, p = curve.getPointAt(u); curve.getTangentAt(u, _t);
    if (mode === 'flat') _s.crossVectors(_t, up).normalize(); else _s.crossVectors(_t, fwd).normalize();
    const w = (Array.isArray(width) ? lerp(width[0], width[1], u) : width) / 2;
    pos.push(p.x + _s.x * w, p.y + _s.y * w, p.z + _s.z * w, p.x - _s.x * w, p.y - _s.y * w, p.z - _s.z * w);
    uv.push(u * L / 3, 0, u * L / 3, 1);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

function createWindmillWorld(THREE, P, E, X, audio) {
  const W = { id: 'windmill', numeral: 'I', name: 'The Windmill', label: 'WINDMILL', bpm: 76 };
  W.look = {
    sky: { top: '#7fb8d6', mid: '#b4d8e4', horizon: '#eef1e3', sun: '#fff1d0', sunDir: [-0.5, 0.45, -0.75] },
    fog: '#e3ece4', fogNear: 34, fogFar: 170, hemiSky: '#d6e8f0', hemiGround: '#a4a36c', hemi: 1.05, sunColor: '#fff2da', sun: 1.55, sunPos: [-16, 26, 18],
    ink: '#2f3a48', paper: '#f6f1e6'
  };
  W.frame = { x0: -6.6, x1: 7.2, y0: -0.6, y1: 18.6, cy: 8.4, z: 0, dist: 34 };

  const C = { // palette
    stone: 0xe4dac5, stone2: 0xd5c7ad, stoneDark: 0xb9a98c, cream: 0xf3ead5, ivory: 0xfaf4e6, slate: 0x5b7b92, slateDark: 0x46627a,
    wood: 0x9c7552, woodDark: 0x6f523b, woodLight: 0xc19a6b, brass: 0xc2a15e, copper: 0xb9774f, oxide: 0x7fb3a3, rust: 0xc0693f,
    coral: 0xe0705a, yellow: 0xf2c35b, sail: 0xf4cf73, sail2: 0xf6ecd2, moss: 0x7f9a52, grass: 0x9bb06a, rock: 0xd9ccb2
  };

  // level definitions ---------------------------------------------------------
  // win: [in-flow window, good window] in seconds. pattern: beats between gusts.
  W.levels = [
    { n: 1, title: 'Get the windmill turning', note: 'The wind keeps coming. Catch it in the sails.', goal: { type: 'catches', need: 6 }, pump: false, sluice: false, lift: false, pattern: [4], jitter: 0, cross: 0, win: [0.12, 0.27], startW: 0, par: 40 },
    { n: 2, title: 'Fill the cistern', note: 'A turning sail is easier to keep turning.', goal: { type: 'fill' }, pump: true, sluice: false, lift: false, pattern: [4, 4, 4, 3], jitter: 0.03, cross: 0, win: [0.11, 0.25], startW: 0, par: 45 },
    { n: 3, title: 'Raise the lift', note: 'The lift climbs when it is caught at the top of each hop.', goal: { type: 'lift' }, pump: true, sluice: true, lift: true, N: 4, pattern: [4], jitter: 0.03, cross: 0, win: [0.11, 0.25], startW: 0.6, par: 40 },
    { n: 4, title: 'Carry a seed to the greenhouse', note: 'Keep water in the cistern, and the wheel keeps turning.', goal: { type: 'deliver', need: 2 }, pump: true, sluice: true, lift: true, N: 4, pattern: [4], jitter: 0.04, cross: 0, win: [0.1, 0.23], startW: 0.45, par: 75 },
    { n: 5, title: 'Mind the crosswind', note: 'Not every wind is yours to catch.', goal: { type: 'deliver', need: 2 }, pump: true, sluice: true, lift: true, N: 4, pattern: [4], jitter: 0.05, cross: 0.4, win: [0.095, 0.22], startW: 0.45, par: 80 },
    { n: 6, title: 'Everything at once', note: 'The wind has its own idea of time.', goal: { type: 'deliver', need: 3 }, pump: true, sluice: true, lift: true, N: 5, pattern: [3, 3, 2], jitter: 0.04, cross: 0.18, win: [0.09, 0.2], startW: 0.4, par: 110 },
    { n: 7, title: 'The living machine', note: 'Keep it all alive for as long as the day lasts.', goal: { type: 'timed', secs: 100 }, pump: true, sluice: true, lift: true, N: 5, weather: true, jitter: 0.05, cross: 0.16, win: [0.085, 0.19], startW: 0.5, par: 100 }
  ];

  const root = new THREE.Group(); W.root = root;
  const U = { t: { value: 0 } };
  let built = false;
  const S = {}; // scene handles

  W.build = (scene) => {
    if (built) { scene.add(root); return; }
    built = true; scene.add(root);
    const mat = P.mat({ brush: 0.14, scale: 1.6 });
    const matFine = P.mat({ brush: 0.08, scale: 3.5 });
    const ink = P.ink(0x3a3431, 0.03), inkThin = P.ink(0x3a3431, 0.016);
    S.mat = mat; S.matFine = matFine;

    // ---------- ground, path, stream ----------
    const pathAt = (x, z) => {
      // a path from the foreground to the windmill door, and a spur to the footbridge
      const px = Math.sin(z * 0.18) * 1.2 - 0.3 + smooth((z - 2) / 8) * 0.0;
      const d1 = Math.abs(x - px) * (z > 1.8 ? 1 : 3);
      return z > 1.8 ? smooth(1 - d1 / 0.9) * 0.9 : 0;
    };
    const ground = E.ground({ grass: 0x9cb067, grass2: 0xaab873, dry: 0xc9be86, path: 0xd8c8a2, pathAt, flat: 14, rise: 9 });
    root.add(ground); S.heightAt = ground.userData.heightAt;
    // the stream, from the wheel pool across the foreground to the left
    const streamPts = [[4.2, 0.06, 1.9], [3.6, 0.06, 3.4], [1.8, 0.06, 5.2], [-1.2, 0.06, 6.4], [-4.5, 0.06, 7.0], [-9, 0.06, 8.2], [-16, 0.06, 9]];
    S.streamMat = waterMaterial(THREE, { scale: 1.2, speed: 0.6, opacity: 0.9 });
    const stream = new THREE.Mesh(stripGeo(THREE, streamPts, [1.1, 2.0], 'flat', 3), S.streamMat); stream.renderOrder = 1; root.add(stream);
    // banks
    const bank = new P.Builder(31);
    const sc = new THREE.CatmullRomCurve3(streamPts.map(p => new THREE.Vector3(...p)));
    for (let i = 0; i < 46; i++) { const u = i / 45, p = sc.getPointAt(u), tn = sc.getTangentAt(u); const side = i % 2 ? 1 : -1; const w = lerp(0.62, 1.05, u); const r = 0.12 + (i * 37 % 7) / 40; bank.add(new THREE.DodecahedronGeometry(r, 0), i % 3 ? C.stone2 : C.stoneDark, { p: [p.x - tn.z * w * side, 0.02, p.z + tn.x * w * side], s: [1.4, 0.55, 1] }, { jitter: 0.04, vary: 0.1 }); }
    root.add(bank.mesh(mat, null));

    // ---------- the windmill ----------
    const wm = new P.Builder(3);
    wm.add(P.tower(2.25, 1.76, 6.4, 11, 3), C.stone, { p: [0, 3.2, 0] }, { shade: 0.22, top: C.stone2, topAmt: 0.2 });
    // quoins and a few proud stones
    const rq = makeRng(9);
    for (let i = 0; i < 26; i++) { const y = rq.range(0.4, 6.0), a = rq.range(-1.6, 1.9) + (i % 2 ? Math.PI : 0); const r = lerp(2.25, 1.76, y / 6.4) + 0.02; wm.add(new THREE.BoxGeometry(rq.range(0.35, 0.7), rq.range(0.18, 0.3), 0.12), rq() < 0.5 ? C.stone2 : C.stoneDark, { p: [Math.sin(a) * r, y, Math.cos(a) * r], r: [0, a, 0] }, { jitter: 0.03 }); }
    // plinth
    wm.add(new THREE.CylinderGeometry(2.45, 2.6, 0.45, 12), C.stoneDark, { p: [0, 0.2, 0] }, { jitter: 0.06 });
    // door arch
    wm.add(new THREE.BoxGeometry(0.95, 1.5, 0.3), 0x4a3c34, { p: [0, 0.95, 2.12] }, { vary: 0 });
    wm.add(new THREE.CylinderGeometry(0.475, 0.475, 0.3, 12, 1, false, -Math.PI / 2, Math.PI), 0x4a3c34, { p: [0, 1.7, 2.12], r: [Math.PI / 2, 0, 0] }, { vary: 0 });
    wm.add(new THREE.BoxGeometry(0.8, 1.35, 0.06), C.woodDark, { p: [0, 0.88, 2.26] });
    wm.add(new THREE.TorusGeometry(0.62, 0.12, 6, 14, Math.PI), C.stone2, { p: [0, 1.7, 2.2] }, { jitter: 0.02 });
    wm.add(new THREE.BoxGeometry(1.5, 0.16, 0.5), C.stoneDark, { p: [0, 0.08, 2.5] }, { jitter: 0.02 }); // step
    // round windows with slate frames
    for (const [y, a] of [[3.3, 0.35], [4.9, -0.5]]) { const r = lerp(2.25, 1.76, y / 6.4); wm.add(new THREE.TorusGeometry(0.26, 0.07, 6, 14), C.slate, { p: [Math.sin(a) * r, y, Math.cos(a) * r], r: [0, a, 0] }); wm.add(new THREE.CircleGeometry(0.24, 14), 0x34404c, { p: [Math.sin(a) * (r - 0.02), y, Math.cos(a) * (r - 0.02)], r: [0, a, 0] }, { vary: 0, shade: 0 }); }
    // balcony
    wm.add(new THREE.CylinderGeometry(2.35, 2.2, 0.16, 16), C.wood, { p: [0, 6.45, 0] });
    for (let i = 0; i < 20; i++) { const a = (i / 20) * TAU; wm.add(new THREE.BoxGeometry(0.05, 0.42, 0.05), C.woodDark, { p: [Math.sin(a) * 2.28, 6.72, Math.cos(a) * 2.28] }); }
    wm.add(new THREE.TorusGeometry(2.28, 0.035, 4, 40), C.woodLight, { p: [0, 6.93, 0], r: [Math.PI / 2, 0, 0] });
    for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU + 0.2; wm.add(new THREE.BoxGeometry(0.1, 0.5, 0.5), C.woodDark, { p: [Math.sin(a) * 1.85, 6.2, Math.cos(a) * 1.85], r: [0, a, 0] }); }
    // upper body: painted cream boards with slate trim
    wm.add(P.tower(1.68, 1.32, 3.6, 12, 5), C.cream, { p: [0, 8.25, 0] }, { shade: 0.12 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; wm.add(new THREE.BoxGeometry(0.06, 3.5, 0.04), 0xe4d6bb, { p: [Math.sin(a) * 1.52, 8.25, Math.cos(a) * 1.52], r: [-0.06 * Math.cos(a), a, 0.06 * Math.sin(a)], order: 'YXZ' }); }
    wm.add(new THREE.TorusGeometry(1.7, 0.07, 5, 24), C.slate, { p: [0, 6.6, 0], r: [Math.PI / 2, 0, 0] });
    wm.add(new THREE.TorusGeometry(1.36, 0.08, 5, 24), C.slate, { p: [0, 10.02, 0], r: [Math.PI / 2, 0, 0] });
    // a little square window and a door onto the balcony
    wm.add(new THREE.BoxGeometry(0.5, 0.62, 0.1), 0x34404c, { p: [-0.55, 8.5, 1.36], r: [0, -0.4, 0] }, { vary: 0 });
    wm.add(new THREE.BoxGeometry(0.6, 0.72, 0.06), C.slate, { p: [-0.53, 8.5, 1.32], r: [0, -0.4, 0] });
    wm.add(new THREE.BoxGeometry(0.62, 1.2, 0.1), C.slateDark, { p: [0.7, 7.15, 1.43], r: [0, 0.45, 0] });
    // cap: a bulging slate-blue bonnet
    const cap = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14; cap.push(new THREE.Vector2(Math.max(0.05, 1.55 * Math.sin(Math.PI * (0.5 + t * 0.48)) + Math.sin(t * Math.PI) * 0.22), 10.0 + t * 2.7)); }
    wm.add(new THREE.LatheGeometry(cap, 14), C.slate, { p: [0, 0, 0] }, { shade: 0.1, top: 0x7b98ab, topAmt: 0.4 });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * TAU; wm.add(new THREE.BoxGeometry(0.05, 2.4, 0.05), C.slateDark, { p: [Math.sin(a) * 1.2, 11.2, Math.cos(a) * 1.2], r: [-0.45 * Math.cos(a), a, 0.45 * Math.sin(a)], order: 'YXZ' }); }
    wm.add(new THREE.CylinderGeometry(0.06, 0.09, 0.9, 6), C.brass, { p: [0, 13.0, 0] });
    wm.add(new THREE.SphereGeometry(0.12, 8, 6), C.brass, { p: [0, 13.5, 0] });
    // dormer on the cap
    wm.add(new THREE.BoxGeometry(0.62, 0.55, 0.5), C.cream, { p: [0.95, 10.95, 0.75], r: [0, 0.9, 0] });
    wm.add(new THREE.ConeGeometry(0.5, 0.35, 4), C.slateDark, { p: [0.95, 11.38, 0.75], r: [0, 0.9 + Math.PI / 4, 0] });
    wm.add(new THREE.CircleGeometry(0.15, 10), 0xffe1a0, { p: [1.15, 10.95, 0.98], r: [0, 0.9, 0] }, { vary: 0, shade: 0 });
    // axle housing toward the rotor
    S.yaw = -0.32;
    const hub = new THREE.Vector3(Math.sin(S.yaw) * 1.85, 10.95, Math.cos(S.yaw) * 1.85);
    S.hub = hub;
    wm.add(new THREE.CylinderGeometry(0.32, 0.42, 1.1, 10), C.slateDark, { p: [hub.x * 0.75, hub.y, hub.z * 0.75], r: [Math.PI / 2, S.yaw, 0], order: 'YXZ' });
    const wmMesh = wm.mesh(mat, ink); root.add(wmMesh);

    // ---------- rotor and sails ----------
    const rotor = new THREE.Group(); rotor.position.copy(hub); rotor.rotation.y = S.yaw; root.add(rotor);
    const spin = new THREE.Group(); rotor.add(spin); S.spin = spin;
    const hb = new P.Builder(7);
    hb.add(new THREE.CylinderGeometry(0.38, 0.38, 0.4, 10), C.wood, { r: [Math.PI / 2, 0, 0], p: [0, 0, 0.15] });
    hb.add(new THREE.CylinderGeometry(0.2, 0.26, 0.3, 10), C.brass, { r: [Math.PI / 2, 0, 0], p: [0, 0, 0.45] });
    hb.add(new THREE.TorusGeometry(0.36, 0.05, 5, 16), C.coral, { p: [0, 0, 0.36] });
    spin.add(hb.mesh(matFine, inkThin));
    S.sails = [];
    const clothMat = (u) => {
      const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: P.ramp, vertexColors: true, side: THREE.DoubleSide });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, u);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uOpen, uFlut, uBelly, uTime, uW;')
          .replace('#include <begin_vertex>', `vec3 transformed = vec3(position);
            float uu = clamp(transformed.x / uW, 0.0, 1.0);
            transformed.x *= mix(0.16, 1.0, uOpen);
            float along = (transformed.y - 0.9) / 4.6;
            transformed.z += sin(3.14159 * uu) * uBelly * 0.42 * (0.6 + 0.4 * sin(3.14159 * clamp(along, 0.0, 1.0)));
            transformed.z += sin(uTime * 15.0 + transformed.y * 2.6 + uu * 5.0) * uFlut * 0.13 * uu * (0.4 + uOpen);
            transformed.z += (1.0 - uOpen) * sin(uu * 18.0) * 0.03;`);
      };
      m.customProgramCacheKey = () => 'cloth';
      return m;
    };
    const SAIL_W = 1.32, SAIL_L = 4.6;
    for (let i = 0; i < 4; i++) {
      const arm = new THREE.Group(); arm.rotation.z = (i / 4) * TAU + 0.4; spin.add(arm);
      const ab = new P.Builder(20 + i);
      ab.add(new THREE.BoxGeometry(0.16, 5.6, 0.14), i === 2 ? C.woodDark : C.wood, { p: [0, 3.0, 0.05] }, { jitter: 0.015 });
      // lattice
      for (let k = 0; k < 9; k++) ab.add(new THREE.BoxGeometry(SAIL_W + 0.1, 0.05, 0.05), C.woodLight, { p: [SAIL_W / 2, 1.0 + k * 0.56, -0.02] });
      ab.add(new THREE.BoxGeometry(0.05, SAIL_L + 0.1, 0.05), C.woodLight, { p: [SAIL_W + 0.03, 3.2, -0.02] });
      ab.add(new THREE.BoxGeometry(0.06, 0.06, 0.25), C.brass, { p: [0, 5.7, 0.05] });
      if (i === 3) { // a tiny birdhouse on the striped sail's spar
        ab.add(new THREE.BoxGeometry(0.22, 0.24, 0.2), C.coral, { p: [-0.2, 4.6, 0.1] });
        ab.add(new THREE.ConeGeometry(0.2, 0.15, 4), C.slate, { p: [-0.2, 4.79, 0.1], r: [0, Math.PI / 4, 0] });
      }
      arm.add(ab.mesh(matFine, inkThin));
      const u = { uOpen: { value: 0.3 }, uFlut: { value: 0 }, uBelly: { value: 0 }, uTime: U.t, uW: { value: SAIL_W } };
      const sail = { arm, u, slats: [] };
      if (i !== 2) {
        const g = new THREE.PlaneGeometry(SAIL_W, SAIL_L, 6, 14); g.translate(SAIL_W / 2, 0.9 + SAIL_L / 2, 0);
        const a = g.attributes.position, col = new Float32Array(a.count * 3), c = new THREE.Color();
        for (let v = 0; v < a.count; v++) {
          const x = a.getX(v), y = a.getY(v);
          if (i === 0) c.set(C.sail).offsetHSL(0, 0, (y - 3) * 0.008);
          else if (i === 1) { c.set(C.sail2); if (x > 0.45 && x < 1.05 && y > 2.6 && y < 3.7) c.set(C.coral); }
          else { c.set(Math.floor((x / SAIL_W) * 6) % 2 ? C.sail : C.sail2); }
          col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b;
        }
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        const cm = new THREE.Mesh(g, clothMat(u)); cm.castShadow = true; arm.add(cm); sail.cloth = cm;
      } else { // the louvred blade: wooden shutters that open flat
        for (let k = 0; k < 8; k++) {
          const sb = new P.Builder(40 + k); sb.add(new THREE.BoxGeometry(SAIL_W, 0.5, 0.04), k % 3 ? C.cream : 0xe8dcc0, { p: [SAIL_W / 2, 0, 0] });
          const sl = sb.mesh(matFine, null); sl.position.set(0, 1.2 + k * 0.56, 0); arm.add(sl); sail.slats.push(sl);
        }
      }
      if (i === 3) { // pennant at the tip
        const pg = new THREE.PlaneGeometry(0.7, 0.18, 6, 1); pg.translate(0.35, 0, 0);
        const pm = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: C.coral, side: THREE.DoubleSide, fog: true }));
        pm.position.set(0, 5.75, 0.1); arm.add(pm); sail.pennant = pm;
      }
      S.sails.push(sail);
    }
    // weather pennant on the finial
    { const pg = new THREE.PlaneGeometry(0.9, 0.22, 8, 1); pg.translate(-0.45, 0, 0); S.vane = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: C.yellow, side: THREE.DoubleSide, fog: true })); S.vane.position.set(0, 13.25, 0); root.add(S.vane); S.vaneG = pg; S.vaneBase = Float32Array.from(pg.attributes.position.array); }

    // ---------- lever and caretaker ----------
    const lv = new P.Builder(50);
    lv.add(new THREE.BoxGeometry(0.16, 0.7, 0.16), C.woodDark, { p: [-1.75, 0.35, 2.75] });
    lv.add(new THREE.BoxGeometry(0.3, 0.12, 0.3), C.stoneDark, { p: [-1.75, 0.04, 2.75] });
    root.add(lv.mesh(mat, inkThin));
    S.lever = new THREE.Group(); S.lever.position.set(-1.75, 0.62, 2.75); root.add(S.lever);
    { const lb = new P.Builder(51); lb.add(new THREE.BoxGeometry(0.05, 0.75, 0.05), C.brass, { p: [0, 0.35, 0] }); lb.add(new THREE.SphereGeometry(0.075, 8, 6), C.coral, { p: [0, 0.75, 0] }); S.lever.add(lb.mesh(matFine, inkThin)); }
    // a rope from the lever up to the balcony, to the brake
    root.add(new THREE.Mesh(P.tube([[-1.72, 1.2, 2.72], [-1.85, 3.5, 2.25], [-1.6, 6.5, 1.65], [-1.2, 9.6, 1.1], [Math.sin(S.yaw) * 1.4, 10.8, Math.cos(S.yaw) * 1.4]], 0.018, 40, 4), new THREE.MeshBasicMaterial({ color: 0x6d5a45, fog: true })));
    S.keeper = X.caretaker(); S.keeper.group.position.set(-2.12, 0, 2.95); S.keeper.group.rotation.y = 0.9; root.add(S.keeper.group);
    // a second little person, mending the pipe
    S.mender = X.caretaker({ coat: 0x8a6f52, hat: 0xd9cfb8 }); S.mender.group.position.set(3.32, 5.42, 1.05); S.mender.group.rotation.y = -0.4; S.mender.group.scale.setScalar(0.95); S.mender.sit = 1; root.add(S.mender.group);

    // ---------- pump house, rod, pipe, cistern ----------
    const ph = new P.Builder(60);
    ph.add(new THREE.BoxGeometry(1.25, 1.05, 1.15), C.stone, { p: [2.85, 0.52, 1.35], r: [0, -0.2, 0] }, { jitter: 0.05 });
    ph.add(new THREE.CylinderGeometry(0.01, 0.95, 0.5, 4, 1), C.rust, { p: [2.85, 1.3, 1.35], r: [0, Math.PI / 4 - 0.2, 0], s: [1, 1, 0.9] });
    ph.add(new THREE.BoxGeometry(0.34, 0.5, 0.06), C.woodDark, { p: [2.75, 0.4, 1.95], r: [0, -0.2, 0] });
    // bracket from the balcony to the rod
    ph.add(new THREE.BoxGeometry(0.9, 0.1, 0.1), C.woodDark, { p: [2.38, 6.32, 1.05], r: [0, -0.3, 0] });
    ph.add(new THREE.BoxGeometry(0.08, 0.6, 0.08), C.woodDark, { p: [2.2, 6.0, 1.0], r: [0, 0, 0.5] });
    // corbel under the cistern, a stone bracket from the tower
    ph.add(new THREE.BoxGeometry(1.3, 0.35, 1.2), C.stone2, { p: [2.55, 3.95, 0.35] }, { jitter: 0.05 });
    ph.add(new THREE.CylinderGeometry(0.2, 0.55, 1.0, 4), C.stone2, { p: [2.35, 3.3, 0.35], r: [0, Math.PI / 4, 0] }, { jitter: 0.05 });
    // cistern: a coopered barrel with copper hoops
    for (let k = 0; k < 16; k++) { const a = (k / 16) * TAU; ph.add(new THREE.BoxGeometry(0.29, 1.2, 0.07), k % 2 ? C.wood : 0xa77f5a, { p: [2.75 + Math.sin(a) * 0.74, 4.72, 0.35 + Math.cos(a) * 0.74], r: [0, a, 0] }, { vary: 0.08 }); }
    for (const y of [4.3, 5.15]) ph.add(new THREE.TorusGeometry(0.775, 0.035, 4, 24), C.copper, { p: [2.75, y, 0.35], r: [Math.PI / 2, 0, 0] });
    ph.add(new THREE.CylinderGeometry(0.72, 0.72, 0.06, 16), C.woodDark, { p: [2.75, 4.15, 0.35] });
    // sluice gate box
    ph.add(new THREE.BoxGeometry(0.3, 0.4, 0.34), C.woodDark, { p: [3.5, 4.38, 0.42] });
    // trough to the wheel: an open wooden chute on a trestle
    const tA = new THREE.Vector3(3.55, 4.25, 0.45), tB = new THREE.Vector3(3.95, 3.02, 1.28);
    const tD = tB.clone().sub(tA), tL = tD.length(), tMid = tA.clone().add(tB).multiplyScalar(0.5);
    const tq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), tD.clone().normalize()), te = new THREE.Euler().setFromQuaternion(tq);
    const tm = new THREE.Matrix4().compose(tMid, tq, new THREE.Vector3(1, 1, 1));
    ph.add(new THREE.BoxGeometry(0.34, tL, 0.05), C.wood, { p: [0, 0, -0.1], m: tm });
    ph.add(new THREE.BoxGeometry(0.05, tL, 0.2), C.woodDark, { p: [-0.17, 0, 0], m: tm });
    ph.add(new THREE.BoxGeometry(0.05, tL, 0.2), C.woodDark, { p: [0.17, 0, 0], m: tm });
    ph.add(new THREE.BoxGeometry(0.08, 2.9, 0.08), C.woodDark, { p: [3.8, 1.5, 0.9] });
    S.troughA = tA; S.troughB = tB;
    // wheel piers
    ph.add(new THREE.BoxGeometry(0.35, 1.6, 0.5), C.stone2, { p: [4.1, 0.8, 0.55] }, { jitter: 0.04 });
    ph.add(new THREE.BoxGeometry(0.35, 1.6, 0.5), C.stone2, { p: [4.1, 0.8, 2.05] }, { jitter: 0.04 });
    ph.add(new THREE.CylinderGeometry(1.35, 1.45, 0.2, 18), C.stoneDark, { p: [4.1, 0.0, 1.35] }, { jitter: 0.04 });
    root.add(ph.mesh(mat, ink));
    // pipe up the tower: weathered copper
    const pipePts = [[3.32, 0.75, 1.45], [3.42, 1.3, 1.3], [3.45, 3.6, 1.1], [3.35, 5.3, 0.85], [3.05, 5.62, 0.55], [2.85, 5.52, 0.42]];
    const pipe = new P.Builder(61); pipe.add(P.tube(pipePts, 0.085, 40, 7), C.copper, {}, { shade: 0.05 });
    for (const u of [0.2, 0.45, 0.7]) { const p = new THREE.CatmullRomCurve3(pipePts.map(q => new THREE.Vector3(...q))).getPointAt(u); pipe.add(new THREE.TorusGeometry(0.11, 0.035, 4, 10), C.oxide, { p: [p.x, p.y, p.z], r: [Math.PI / 2, 0, 0] }); }
    root.add(pipe.mesh(matFine, inkThin));
    // pump rod (moves)
    { const rb = new P.Builder(62); rb.add(new THREE.BoxGeometry(0.09, 5.3, 0.09), C.woodDark, {}); rb.add(new THREE.BoxGeometry(0.2, 0.12, 0.2), C.brass, { p: [0, -2.6, 0] }); S.rod = rb.mesh(matFine, inkThin); S.rod.position.set(2.7, 3.75, 1.1); root.add(S.rod); }
    // clutch gear on the bracket, visibly out of mesh when the pump is off
    S.clutch = new THREE.Mesh((() => { const b = new P.Builder(63); b.add(P.gearGeo(0.32, 12, 0.1, { hole: 0.06, windows: 4 }), C.brass, {}); return b.build(); })(), matFine);
    S.clutch.position.set(2.15, 6.65, 1.25); S.clutch.rotation.y = 0.4; root.add(S.clutch);
    // water inside the cistern
    S.waterTopMat = waterMaterial(THREE, { scale: 0.8, speed: 0.15, opacity: 0.95 });
    S.cisternWater = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), S.waterTopMat); S.cisternWater.rotation.x = -Math.PI / 2; S.cisternWater.position.set(2.75, 4.2, 0.35); root.add(S.cisternWater);
    // water ribbons: trough, fall onto the wheel, pump spout, overflow
    S.troughMat = waterMaterial(THREE, { scale: 2, speed: 2.6, opacity: 0.0 });
    const tw = new THREE.Mesh(stripGeo(THREE, [[tA.x, tA.y + 0.06, tA.z], [tB.x, tB.y + 0.06, tB.z]], 0.26, 'flat', 6), S.troughMat); root.add(tw);
    S.fallMat = waterMaterial(THREE, { scale: 2.5, speed: 3.2, opacity: 0.0 });
    const fall = new THREE.Mesh(stripGeo(THREE, [[tB.x, tB.y + 0.05, tB.z], [tB.x + 0.22, tB.y - 0.25, tB.z + 0.02], [tB.x + 0.36, tB.y - 0.9, tB.z + 0.02]], [0.24, 0.16], 'vert', 8), S.fallMat); root.add(fall);
    S.spoutMat = waterMaterial(THREE, { scale: 3, speed: 3, opacity: 0.0 });
    const spout = new THREE.Mesh(stripGeo(THREE, [[2.85, 5.5, 0.42], [2.8, 5.0, 0.4], [2.78, 4.4, 0.38]], [0.1, 0.06], 'vert', 8), S.spoutMat); root.add(spout);
    S.spillMat = waterMaterial(THREE, { scale: 3, speed: 2.4, opacity: 0.0 });
    const spill = new THREE.Mesh(stripGeo(THREE, [[2.2, 5.35, 0.9], [2.0, 4.6, 1.1], [1.9, 3.8, 1.2]], [0.5, 0.3], 'vert', 8), S.spillMat); root.add(spill);

    // ---------- water wheel ----------
    S.wheel = new THREE.Group(); S.wheel.position.set(4.1, 1.55, 1.3); root.add(S.wheel);
    { const b = new P.Builder(70);
      P.wheel(b, C.wood, { p: [0, 0, -0.35] }, 1.25, 8, 0.12, { rim: 0.06, hubColor: C.woodDark });
      P.wheel(b, C.wood, { p: [0, 0, 0.35] }, 1.25, 8, 0.12, { rim: 0.06, hubColor: C.woodDark });
      for (let k = 0; k < 14; k++) { const a = (k / 14) * TAU; b.add(new THREE.BoxGeometry(0.42, 0.06, 0.78), k % 4 ? C.woodLight : C.cream, { p: [Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0], r: [0, 0, a] }); }
      b.add(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 8), C.woodDark, { r: [Math.PI / 2, 0, 0] });
      // the cam: a coral knuckle that kicks the lift twice a turn
      b.add(new THREE.BoxGeometry(0.75, 0.16, 0.12), C.coral, { p: [0, 0, 0.82] });
      S.wheel.add(b.mesh(mat, ink)); }

    // ---------- the cliff, the lift, the greenhouse ----------
    const cl = new P.Builder(80);
    const rc = makeRng(81);
    for (let i = 0; i < 46; i++) {
      const x = rc.range(2.6, 9.5), z = rc.range(-7, -1.1), w = rc.range(1.2, 2.6), h = rc.range(1.4, 2.6);
      for (let y = 0; y < 7.4; y += h * 0.9) { const top = y + h > 7.0; cl.add(new THREE.BoxGeometry(w, Math.min(h, 7.6 - y), rc.range(1.2, 2.2)), rc() < 0.25 ? C.stoneDark : (rc() < 0.5 ? C.rock : C.stone2), { p: [x + rc.range(-0.15, 0.15), y + Math.min(h, 7.6 - y) / 2, z], r: [0, rc.range(-0.15, 0.15), 0] }, { jitter: 0.1, top: top ? C.moss : undefined, topAmt: 0.5, shade: 0.25 }); if (top) break; }
    }
    cl.add(new THREE.BoxGeometry(7.2, 0.4, 6.2), C.moss, { p: [6.1, 7.55, -4.0] }, { jitter: 0.12, shade: 0 });
    root.add(cl.mesh(mat, ink));
    // lift tower
    const lt = new P.Builder(90);
    const LX = 5.25, LZ = 0.6;
    for (const [dx, dz] of [[-0.48, -0.42], [0.48, -0.42], [-0.48, 0.42], [0.48, 0.42]]) lt.add(new THREE.BoxGeometry(0.12, 8.4, 0.12), C.wood, { p: [LX + dx, 4.2, LZ + dz] }, { jitter: 0.01 });
    for (let y = 0.6; y < 8; y += 1.25) {
      lt.add(new THREE.BoxGeometry(1.0, 0.08, 0.08), C.woodDark, { p: [LX, y, LZ + 0.42] }); lt.add(new THREE.BoxGeometry(1.0, 0.08, 0.08), C.woodDark, { p: [LX, y, LZ - 0.42] });
      lt.add(new THREE.BoxGeometry(0.06, 1.4, 0.06), C.woodDark, { p: [LX + 0.48, y + 0.62, LZ - 0.42], r: [0, 0, 0.62] });
    }
    lt.add(new THREE.BoxGeometry(1.5, 0.12, 0.3), C.woodDark, { p: [LX, 8.4, LZ] });
    // ratchet rack: coral teeth that read as the lift's progress marks
    S.rackY = [];
    // top deck and bridge to the cliff
    lt.add(new THREE.BoxGeometry(1.2, 0.1, 1.5), C.woodLight, { p: [LX - 0.15, 7.62, -0.35] });
    for (let k = 0; k < 6; k++) lt.add(new THREE.BoxGeometry(0.05, 0.4, 0.05), C.woodDark, { p: [LX + 0.45, 7.85, 0.3 - k * 0.27] });
    lt.add(new THREE.BoxGeometry(0.05, 0.05, 1.5), C.woodLight, { p: [LX + 0.45, 8.05, -0.35] });
    // winch at the foot of the lift, linked to the wheel's cam
    lt.add(new THREE.BoxGeometry(1.3, 0.3, 1.2), C.stoneDark, { p: [LX, 0.15, LZ] }, { jitter: 0.04 });
    root.add(lt.mesh(mat, ink));
    S.pulley = new THREE.Group(); S.pulley.position.set(LX, 8.85, LZ); root.add(S.pulley);
    { const b = new P.Builder(91); P.wheel(b, C.brass, {}, 0.72, 6, 0.12, { rim: 0.07, hubColor: C.coral }); S.pulley.add(b.mesh(matFine, inkThin)); }
    S.winch = new THREE.Group(); S.winch.position.set(LX - 0.55, 0.55, LZ + 0.55); root.add(S.winch);
    { const b = new P.Builder(92); b.add(new THREE.CylinderGeometry(0.22, 0.22, 0.5, 10), C.woodDark, { r: [0, 0, Math.PI / 2] }); b.add(new THREE.BoxGeometry(0.06, 0.5, 0.06), C.coral, { p: [0, 0.25, 0.2] }); S.winch.add(b.mesh(matFine, inkThin)); }
    // pushrod from the wheel to the winch
    S.pushrod = new THREE.Mesh(new THREE.BoxGeometry(1, 0.06, 0.06), matFine); root.add(S.pushrod);
    { const g = S.pushrod.geometry; const col = new Float32Array(g.attributes.position.count * 3).fill(0.5); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); }
    // cage
    S.cage = new THREE.Group(); root.add(S.cage);
    { const b = new P.Builder(93);
      b.add(new THREE.BoxGeometry(0.8, 0.07, 0.75), C.woodDark, { p: [0, 0, 0] });
      for (const [dx, dz] of [[-0.38, -0.35], [0.38, -0.35], [-0.38, 0.35], [0.38, 0.35]]) b.add(new THREE.BoxGeometry(0.05, 0.8, 0.05), C.brass, { p: [dx, 0.4, dz] });
      b.add(new THREE.BoxGeometry(0.85, 0.06, 0.8), C.slate, { p: [0, 0.82, 0] });
      b.add(new THREE.ConeGeometry(0.6, 0.25, 4), C.slate, { p: [0, 0.97, 0], r: [0, Math.PI / 4, 0] });
      b.add(new THREE.BoxGeometry(0.78, 0.04, 0.04), C.brass, { p: [0, 0.35, 0.36] });
      S.cage.add(b.mesh(matFine, inkThin)); }
    S.pawl = new THREE.Group(); S.pawl.position.set(0.42, 0.45, 0.36); S.cage.add(S.pawl);
    { const b = new P.Builder(94); b.add(new THREE.BoxGeometry(0.06, 0.3, 0.06), C.coral, { p: [0, -0.12, 0] }); S.pawl.add(b.mesh(matFine, null)); }
    // ropes (unit cylinders stretched each frame)
    const ropeMat = new THREE.MeshBasicMaterial({ color: 0x5e4c3c, fog: true });
    S.rope1 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), ropeMat); root.add(S.rope1);
    S.rope2 = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 1, 4), ropeMat); root.add(S.rope2);
    S.weight = new THREE.Mesh((() => { const b = new P.Builder(95); b.add(new THREE.BoxGeometry(0.3, 0.5, 0.25), C.stoneDark, {}); return b.build(); })(), mat); root.add(S.weight);
    S.LX = LX; S.LZ = LZ;
    // greenhouse
    const GX = 4.75, GZ = -2.55, GY = 7.75;
    const gh = new P.Builder(100);
    gh.add(new THREE.BoxGeometry(2.6, 0.3, 1.9), C.stone2, { p: [GX, GY - 0.05, GZ] }, { jitter: 0.04 });
    const frame = (x0, y0, z0, x1, y1, z1, t = 0.06) => { const a = new THREE.Vector3(x0, y0, z0), b = new THREE.Vector3(x1, y1, z1), d = b.clone().sub(a); const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()); gh.add(new THREE.BoxGeometry(t, d.length(), t), C.ivory, { m: new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)) }, { vary: 0.02, shade: 0.05 }); };
    const hx = 1.2, hz = 0.85, hh = 1.35, pk = 2.15;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) frame(GX + sx * hx, GY + 0.1, GZ + sz * hz, GX + sx * hx, GY + hh, GZ + sz * hz);
    for (let k = -2; k <= 2; k++) { frame(GX + k * hx / 2, GY + 0.1, GZ + hz, GX + k * hx / 2, GY + hh, GZ + hz, 0.04); frame(GX + k * hx / 2, GY + hh, GZ + hz, GX + k * hx / 2, GY + pk, GZ, 0.045); frame(GX + k * hx / 2, GY + hh, GZ - hz, GX + k * hx / 2, GY + pk, GZ, 0.045); }
    frame(GX - hx, GY + pk, GZ, GX + hx, GY + pk, GZ); frame(GX - hx, GY + hh, GZ + hz, GX + hx, GY + hh, GZ + hz); frame(GX - hx, GY + hh, GZ - hz, GX + hx, GY + hh, GZ - hz);
    frame(GX - hx, GY + 0.7, GZ + hz, GX + hx, GY + 0.7, GZ + hz, 0.04);
    // a little bell gable
    frame(GX - hx, GY + hh, GZ + hz, GX - hx, GY + pk + 0.5, GZ + hz * 0.3, 0.06);
    gh.add(new THREE.BoxGeometry(0.5, 0.06, 0.4), C.slate, { p: [GX - hx, GY + pk + 0.55, GZ + hz * 0.3] });
    // pots
    S.pots = [];
    for (let k = 0; k < 6; k++) { const x = GX - 0.95 + k * 0.38, z = GZ + 0.45; gh.add(new THREE.CylinderGeometry(0.11, 0.08, 0.16, 8), C.rust, { p: [x, GY + 0.18, z] }); S.pots.push(new THREE.Vector3(x, GY + 0.26, z)); }
    gh.add(new THREE.BoxGeometry(2.3, 0.08, 0.45), C.woodLight, { p: [GX, GY + 0.08, GZ + 0.45] });
    root.add(gh.mesh(matFine, inkThin));
    S.glassU = { value: 0 };
    const glassM = new THREE.MeshLambertMaterial({ color: 0xcfe8ea, transparent: true, opacity: 0.32, depthWrite: false, side: THREE.DoubleSide, emissive: new THREE.Color(0xffd27a), emissiveIntensity: 0 });
    S.glassM = glassM;
    const glass = new THREE.Group();
    const pane = (w, h, x, y, z, ry, rx = 0) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glassM); m.position.set(x, y, z); m.rotation.set(rx, ry, 0, 'YXZ'); glass.add(m); };
    pane(2.4, 1.25, GX, GY + 0.72, GZ + hz, 0); pane(2.4, 1.25, GX, GY + 0.72, GZ - hz, 0); pane(1.7, 1.25, GX - hx, GY + 0.72, GZ, Math.PI / 2); pane(1.7, 1.25, GX + hx, GY + 0.72, GZ, Math.PI / 2);
    const sl = Math.hypot(hz, pk - hh); pane(2.4, sl, GX, GY + (hh + pk) / 2, GZ + hz / 2, 0, -Math.atan2(hz, pk - hh)); pane(2.4, sl, GX, GY + (hh + pk) / 2, GZ - hz / 2, 0, Math.atan2(hz, pk - hh));
    glass.renderOrder = 3; root.add(glass);
    S.lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false })); S.lamp.position.set(GX, GY + 1.2, GZ); S.lamp.scale.set(2.4, 2.4, 1); root.add(S.lamp);
    S.flowers = S.pots.map((p, k) => { const f = X.flower([C.coral, 0xf2c25a, 0xe9a1b3, 0xf6ecd2, C.coral, 0xb8c8e8][k], k === 1 ? 0xe0705a : 0xf2c25a, 1.0); f.group.position.copy(p); root.add(f.group); return f; });
    S.bell = X.bell(1.0); S.bell.group.position.set(GX - hx, GY + pk + 0.5, GZ + hz * 0.3); root.add(S.bell.group);
    S.ghDoor = new THREE.Vector3(GX - 0.3, GY + 0.0, GZ + hz + 0.1);

    // ---------- the creature, seeds, garden ----------
    S.critter = X.creature(); root.add(S.critter.group);
    const bk = new P.Builder(110);
    bk.add(new THREE.CylinderGeometry(0.28, 0.22, 0.26, 10, 1, true), C.woodLight, { p: [4.55, 0.13, 2.85] }, { vary: 0.05 });
    bk.add(new THREE.CylinderGeometry(0.22, 0.22, 0.03, 10), C.woodDark, { p: [4.55, 0.02, 2.85] });
    for (let k = 0; k < 5; k++) bk.add(new THREE.SphereGeometry(0.06, 6, 4), C.yellow, { p: [4.48 + (k % 3) * 0.07, 0.27, 2.8 + (k > 2 ? 0.08 : 0)] }, { vary: 0, shade: 0 });
    root.add(bk.mesh(matFine, inkThin));
    S.basket = new THREE.Vector3(4.3, 0, 2.95);
    S.liftDoor = new THREE.Vector3(LX - 0.1, 0, LZ + 0.95);
    S.garden = [];
    const gr = makeRng(120);
    for (let k = 0; k < 16; k++) {
      const x = k < 8 ? gr.range(1.7, 3.6) : gr.range(-3.6, -2.4), z = k < 8 ? gr.range(2.4, 3.6) : gr.range(1.0, 2.2);
      const f = X.flower(gr.pick([C.coral, 0xf2c25a, 0xf6ecd2, 0xe9a1b3, 0xb8c8e8]), 0xf2c25a, gr.range(0.7, 1.1));
      f.group.position.set(x, 0, z); f.thr = 0.15 + (k / 16) * 0.8; root.add(f.group); S.garden.push(f);
    }

    // ---------- the rest of the little world ----------
    const fb = new P.Builder(130), tb = new P.Builder(131);
    E.tree(tb, fb, -3.7, 0, -1.6, 1.3, 3);
    E.tree(tb, fb, -8.5, 0.2, -4.5, 1.6, 4);
    E.tree(tb, fb, -11, 0.3, -1, 1.2, 5);
    E.tree(tb, fb, 8.2, 7.6, -5.2, 1.2, 6);
    E.tree(tb, fb, 6.8, 7.6, -6.2, 0.9, 7);
    E.tree(tb, fb, -5.2, 0.4, -10, 1.8, 8);
    E.tree(tb, fb, 10, 0.3, 4, 1.4, 9);
    // a tree that has grown up against the pump house
    E.tree(tb, fb, 3.55, 0, 2.15, 0.6, 10, { leaves: [0x8fa660, 0x9fb06a] });
    const bush = (x, z, s, seed) => { const r = makeRng(seed); for (let i = 0; i < 3; i++) fb.add(P.blob(r.range(0.35, 0.55) * s, seed * 3 + i), r.pick([0x7d9152, 0x8a9a5b, 0x93a663]), { p: [x + r.range(-0.4, 0.4) * s, (S.heightAt ? S.heightAt(x, z) : 0) + 0.25 * s, z + r.range(-0.3, 0.3) * s] }, { shade: 0.35, top: 0xc9c77a, topAmt: 0.4 }); };
    bush(-2.9, 1.0, 1, 1); bush(-4.6, -0.2, 1.3, 2); bush(1.9, -1.4, 1.2, 3); bush(6.5, 7.6, -1.6, 4); bush(-6.5, 3, 1, 5); bush(7, 2.2, 1.2, 6); bush(-1.5, -2.1, 1.1, 7);
    S.foliage = new THREE.Mesh(fb.build(), E.foliageMat()); S.foliage.castShadow = true; S.foliage.receiveShadow = true; root.add(S.foliage);
    root.add(tb.mesh(mat, inkThin));
    // cottage with chimney
    const ct = new P.Builder(140);
    ct.add(new THREE.BoxGeometry(2.6, 1.8, 2.0), C.cream, { p: [-7.2, 0.9, -4.6], r: [0, 0.35, 0] }, { jitter: 0.06 });
    ct.add(new THREE.CylinderGeometry(0.01, 2.0, 1.3, 4), C.rust, { p: [-7.2, 2.45, -4.6], r: [0, 0.35 + Math.PI / 4, 0], s: [1.35, 1, 1.0] });
    ct.add(new THREE.BoxGeometry(0.35, 0.9, 0.35), C.stone2, { p: [-6.6, 2.9, -4.9] }, { jitter: 0.03 });
    ct.add(new THREE.BoxGeometry(0.4, 0.5, 0.06), 0x34404c, { p: [-6.8, 1.0, -3.6], r: [0, 0.35, 0] }, { vary: 0 });
    ct.add(new THREE.BoxGeometry(0.45, 0.9, 0.06), C.slate, { p: [-7.7, 0.45, -3.75], r: [0, 0.35, 0] });
    // the cart, sacks, a fence
    ct.add(new THREE.BoxGeometry(1.1, 0.25, 0.7), C.woodLight, { p: [-4.3, 0.55, 2.2], r: [0, 0.5, 0.12] });
    ct.add(new THREE.TorusGeometry(0.3, 0.05, 5, 12), C.woodDark, { p: [-4.15, 0.32, 2.62], r: [0, 0.5, 0] });
    ct.add(new THREE.BoxGeometry(1.2, 0.05, 0.05), C.woodDark, { p: [-3.55, 0.4, 2.6], r: [0, 0.5, -0.35] });
    for (let k = 0; k < 2; k++) ct.add(new THREE.SphereGeometry(0.2, 7, 5), 0xd6c39a, { p: [-4.4 + k * 0.3, 0.8, 2.2 - k * 0.1], s: [1, 0.8, 0.8] });
    for (let k = 0; k < 9; k++) { const x = -9 + k * 0.9, z = 0.6 + Math.sin(k) * 0.3; ct.add(new THREE.BoxGeometry(0.07, 0.6, 0.07), C.woodDark, { p: [x, 0.3, z] }); if (k < 8) ct.add(new THREE.BoxGeometry(0.92, 0.05, 0.04), C.woodLight, { p: [x + 0.45, 0.45, z], r: [0, 0, 0.03] }); }
    // footbridge over the stream
    for (let k = 0; k < 7; k++) ct.add(new THREE.BoxGeometry(0.22, 0.06, 1.0), C.woodLight, { p: [0.4 + k * 0.23, 0.18 + Math.sin(k / 6 * Math.PI) * 0.12, 5.6 + k * 0.05], r: [0, -0.35, 0] });
    for (const zz of [-0.45, 0.45]) ct.add(P.tube([[0.35, 0.5, 5.55 + zz], [1.1, 0.62, 5.75 + zz * 0.95], [1.85, 0.5, 5.95 + zz * 0.9]], 0.025, 12, 4), C.woodDark, {});
    root.add(ct.mesh(mat, ink));
    S.smoke = E.smoke(root, P, [-6.6, 3.4, -4.9]);

    // grass across the meadow, thinner near paths and the stream
    root.add(E.grass({ count: 4200, x0: -22, x1: 12, z0: -9, z1: 12, root: 0x8aa35c, tip: 0xd0d48c, tip2: 0xe8dca0, scale: 0.75, heightAt: S.heightAt, seed: 5,
      accept: (x, z, r) => (z < 6 || r() < 0.45) && !(x > 2.4 && x < 10 && z < -0.8 && z > -8) && pathAt(x, z) < 0.3 && Math.hypot(x, z) > 2.5 && !(x > 3 && x < 6.2 && z > 0 && z < 2.3) }));
    // distant layers
    root.add(E.layers([
      { kind: 'spires', seed: 3, w: 300, y: 30, z: -140, color: 0xc3d3d6 },
      { kind: 'hills', seed: 7, w: 260, y: 14, z: -110, color: 0xb3c8b8, order: 1 },
      { kind: 'town', seed: 11, w: 200, y: 8, z: -80, color: 0xa7b9a6, order: 2 },
    ]));
    root.add(E.wildflowers({ count: 700, x0: -20, x1: 11, z0: -6, z1: 13, heightAt: S.heightAt, accept: (x, z) => pathAt(x, z) < 0.2 && Math.hypot(x, z) > 2.8 && !(x > 2.4 && x < 10 && z < -0.8) && !(x > 3 && x < 6.2 && z > 0 && z < 2.3) }));
    S.clouds = E.clouds({ count: 12, y0: 14, y1: 70 }); root.add(S.clouds);
    // birds on the balcony rail and the cap
    S.birds = E.birds(root, [[-1.2, 7.0, 1.85], [-0.6, 7.0, 2.2], [1.6, 7.0, 1.6], [0.25, 13.65, 0.1], [4.0, 8.42, 0.6]]);
    S.ribbons = E.ribbons(root);
    S.leaves = E.leaves(root, 80);
    // little lanterns on the balcony that light with flow
    S.lanterns = [];
    for (const a of [-0.9, 0.0, 0.9]) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffcf7a, transparent: true, opacity: 0, depthWrite: false })); s.position.set(Math.sin(a) * 2.3, 7.15, Math.cos(a) * 2.3); s.scale.set(0.6, 0.6, 1); root.add(s); S.lanterns.push(s); const lb = new P.Builder(160); lb.add(new THREE.CylinderGeometry(0.06, 0.07, 0.14, 6), C.brass, {}); const lm = new THREE.Mesh(lb.build(), matFine); lm.position.copy(s.position); root.add(lm); }
    // gust paths
    S.gustCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-19, 1.0, 7.5), new THREE.Vector3(-12, 1.3, 6), new THREE.Vector3(-6.5, 2.6, 4.6), new THREE.Vector3(-3, 6.5, 3.6), new THREE.Vector3(hub.x - 0.6, hub.y - 0.3, hub.z + 1.2)]);
    S.crossCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(18, 10.5, 6), new THREE.Vector3(11, 10.2, 5), new THREE.Vector3(5.5, 11.2, 3.8), new THREE.Vector3(hub.x + 0.8, hub.y + 0.2, hub.z + 1.2)]);
  };

  // ---------- simulation state ----------
  let st = null;
  const notchY = k => 0.12 + k * ((7.62 - 0.12) / st.N);
  W.begin = (level, G) => {
    S.ribbons.clear(); S.leaves.clear();
    st = {
      L: level, theta: st ? st.theta : 0.3, omega: 0.15, open: 0.25, openT: -9, belly: 0, bellyT: -9, flut: 0,
      water: level.startW || 0, spill: 0, pumpPhase: 0, prevSin: 0, strokes: 0,
      wheelA: 0, wheelW: 0, prevCam: 0,
      N: level.N || 4, n: 0, liftMode: 'idle', liftY: 0.12, liftV: 0, bounce: null, liftT: 0,
      critter: { s: 'basket', t: 0, pos: S.basket.clone(), seed: true, k: 0, path: null },
      deliveries: 0, lifts: 0, catches: 0, gusts: [], nextBeat: 4, patIdx: 0, weatherIdx: 0, weather: null,
      lastCatch: 0, stillT: 0, crossTaps: 0, finale: false, hatT: -1, bloomsShown: 0, potK: 0
    };
    st.critter.pos.copy(S.basket); st.critter.seed = true;
    for (const f of S.flowers) f.set(0);
    for (const f of S.garden) f.set(0);
    S.keeper.hatOff = 0; S.keeper.sit = 0;
    S.clutch.position.x = level.pump ? 2.15 : 1.95;
    if (level.weather) st.weather = makeWeather(G.rng);
  };
  // the day's weather: a sequence of wind moods, each a bar or two long
  function makeWeather(rng) {
    const moods = [{ p: [4], c: 0 }, { p: [3, 3, 2], c: 0.1 }, { p: [2, 2, 4], c: 0 }, { p: [6, 2], c: 0.2 }, { p: [4, 2, 2], c: 0.1 }, { p: [3, 5], c: 0.25 }, { p: [8], c: 0.5 }];
    const seq = [moods[0]]; for (let i = 0; i < 12; i++) seq.push(rng.pick(moods.slice(1)));
    return seq;
  }
  function patternNow() {
    if (st.weather) { const m = st.weather[Math.min(st.weather.length - 1, Math.floor(st.nextBeat / 16))]; return { p: m.p, c: Math.max(st.L.cross * 0.6, m.c) }; }
    return { p: st.L.pattern, c: st.L.cross };
  }
  const LEAD_BEATS = 3;
  function schedule(G) {
    const beat = G.beat;
    // keep two gusts of lookahead
    while (G.beatTime(st.nextBeat) - LEAD_BEATS * beat < G.t + 0.05) {
      const { p, c } = patternNow();
      const gap = p[st.patIdx % p.length];
      const arrive = G.beatTime(st.nextBeat) + (st.L.jitter ? G.rng.range(-st.L.jitter, st.L.jitter) : 0);
      spawnGust(G, arrive, false);
      if (c > 0 && gap >= 4 && G.rng() < c) spawnGust(G, G.beatTime(st.nextBeat + gap / 2), true);
      st.nextBeat += gap; st.patIdx++;
    }
  }
  function spawnGust(G, arrive, cross) {
    const lead = (cross ? 2.6 : LEAD_BEATS) * G.beat;
    const gust = { cross, tA: arrive, t0: arrive - lead, curve: cross ? S.crossCurve : S.gustCurve, res: null, resT: 0, strength: 0.8 + G.rng() * 0.4 };
    gust.op = G.addOp(cross ? 'cross' : 'gust', arrive, { gust }, cross);
    S.ribbons.spawn(gust, cross ? 3 : 4, cross ? 0x7d93ab : 0xf3c45a);
    audio.gust(arrive, lead, gust.strength, cross);
    st.gusts.push(gust);
  }

  // ---------- resolutions ----------
  W.resolve = (op, res, d, G) => {
    const t = G.t;
    if (op.kind === 'gust') {
      const g = op.data.gust; g.res = res; g.resT = t;
      openSails(t);
      if (res === 'flow' || res === 'good') {
        const q = res === 'flow' ? 1 : 0.6;
        const mom = clamp(st.omega / 3.2);
        st.omega = Math.min(3.6, st.omega + q * (0.95 + 0.6 * mom) + 0.15);
        st.belly = q; st.bellyT = t; st.catches++; st.lastCatch = t;
        audio.catchFlow(t, q);
        S.leaves.swirl(S.hub, 0.6);
        S.keeper.sit = 0;
        G.focus(S.hub, 0.25 * q);
      } else if (res === 'early') {
        st.omega += 0.22; st.belly = 0.2; st.bellyT = t; audio.luff(t);
      } else { // late: the gust has gone through already
        audio.knock(t, 0.8, 0.8); st.belly = -0.1; st.bellyT = t;
      }
    } else if (op.kind === 'cross') {
      const g = op.data.gust; g.res = 'snag'; g.resT = t;
      openSails(t);
      st.omega = -0.9; st.belly = -0.9; st.bellyT = t;
      audio.luff(t); audio.knock(t + 0.05, 0.6, 1);
      S.keeper.hatOff = 1; st.hatT = t;
      S.birds.startle(S.hub, 6); audio.flutter(t);
      G.focus(S.hub, -0.15);
    } else if (op.kind === 'apex') {
      const b = st.bounce; if (!b || b.op !== op) return;
      if (res === 'flow' || res === 'good') {
        st.n = Math.min(st.N, st.n + 1); st.liftMode = 'settle'; st.liftT = t; st.bounce = null; st.liftV = -0.6;
        audio.latch(t, res === 'flow' ? 1 : 0.7, st.n * 2);
        S.pawl.rotation.z = 0.8;
        if (st.n >= st.N) { st.liftMode = 'top'; st.lifts++; G.event('lift-top'); }
      } else { b.slip = true; audio.knock(t, 1.4, 0.9); audio.ratchet(t + 0.05); S.pawl.rotation.z = -0.6; }
    }
  };
  W.passed = (op, G) => {
    if (op.kind === 'gust') { const g = op.data.gust; if (!g.res) { g.res = 'miss'; g.resT = G.t; st.omega += 0.12; audio.whooshPast(G.t); } }
    else if (op.kind === 'cross') { const g = op.data.gust; g.res = 'weathered'; g.resT = G.t; st.omega *= 0.85; }
  };
  W.idle = (G) => { openSails(G.t); audio.luff(G.t); st.belly = 0.15; st.bellyT = G.t; };
  function openSails(t) { st.openT = t; S.keeper.pull = 1; }

  // autopilot for the finale: let the machine show itself working
  W.objective = (G) => {
    const g = st.L.goal;
    if (g.type === 'catches') return { ticks: st.catches, need: g.need, done: st.catches >= g.need };
    if (g.type === 'fill') return { ticks: Math.floor(st.water * 5 + 0.001), need: 5, done: st.water >= 0.985 };
    if (g.type === 'lift') return { ticks: st.n, need: st.N, done: st.lifts >= 1 };
    if (g.type === 'deliver') return { ticks: st.deliveries, need: g.need, done: st.deliveries >= g.need };
    return { ticks: st.deliveries, need: 0, done: false, timed: true };
  };
  W.stats = () => ({ deliveries: st.deliveries, lifts: st.lifts, water: st.water });
  W._st = () => st;
  W.hint = () => { const g = st.gusts.find(q => !q.res && !q.cross); return g ? { gust: g, hub: S.hub } : null; };
  W.discovery = () => (st.L.n === 3 ? 'the lift' : st.L.n === 4 ? 'the greenhouse' : st.L.n === 5 ? 'the crosswind' : st.L.n === 2 ? 'the cistern' : null);

  // ---------- update ----------
  const _p = new THREE.Vector3(), _q = new THREE.Vector3();
  W.update = (dt, G) => {
    const t = G.t, beat = G.beat, L = st.L, flow = G.flow;
    U.t.value = t;
    schedule(G);
    // gusts: front position, grass wave, ribbons, leaves
    const gU = E.windU.uG.value; let gi = 0, near = 0, nearCross = 0, windX = 0.3;
    for (let i = st.gusts.length - 1; i >= 0; i--) {
      const g = st.gusts[i];
      const s = (t - g.t0) / (g.tA - g.t0);
      const caught = g.res === 'flow' || g.res === 'good';
      if (s > (caught ? 1.25 : 1.9) || (g.res === 'snag' && t - g.resT > 1.2)) { S.ribbons.release(g); st.gusts.splice(i, 1); continue; }
      const sEase = s < 1 ? s : 1 + (s - 1) * (caught ? 0.4 : 1);
      const fade = (s < 0.15 ? s / 0.15 : 1) * (caught ? clamp(1 - (s - 1) * 4) : clamp(1 - (s - 1) * 1.4));
      S.ribbons.draw(g, sEase, fade, t);
      g.curve.getPointAt(clamp(sEase), _p);
      if (gi < 4 && s > 0 && s < 1.6) { gU[gi].set(g.cross ? _p.x : lerp(_p.x, _p.x + (s - 1) * 15, s > 1 ? 1 : 0), 0.9 * g.strength * fade, g.cross ? -1 : 1, 3.2); gi++; }
      if (s < 1 && s > 0.05 && Math.random() < dt * (g.cross ? 10 : 22)) S.leaves.emit(_p, _q.set(g.cross ? -5 : 5.5, 0.6, -0.4), 1, 1.4);
      if (s < 1) { if (g.cross) nearCross = Math.max(nearCross, smooth((s - 0.5) / 0.5)); else near = Math.max(near, smooth((s - 0.5) / 0.5)); }
      if (s > 0.4 && s < 1.2) windX = g.cross ? -4 : 5;
    }
    for (; gi < 4; gi++) gU[gi].set(0, 0, 1, 1);
    E.windU.uTime.value = t; E.windU.uBase.value = 0.12 + flow * 0.12;
    S.leaves.update(dt, windX);

    // rotor
    const drag = lerp(0.42, 0.18, flow);
    const idleW = 0.12 + flow * 0.5;
    st.omega += (idleW - st.omega) * (1 - Math.exp(-drag * dt));
    const prevTheta = st.theta; st.theta += st.omega * dt;
    S.spin.rotation.z = st.theta;
    // blade-pass creaks and a thump per revolution
    const q0 = Math.floor(prevTheta / (Math.PI / 2)), q1 = Math.floor(st.theta / (Math.PI / 2));
    if (q1 !== q0 && Math.abs(st.omega) > 0.5) { audio.creak(t, clamp(st.omega / 3.2), q1); if ((q1 % 4 + 4) % 4 === 0) audio.thump(t, clamp(st.omega / 3)); }
    // sails: open on a pull, belly on a catch, flutter as wind nears
    const sinceOpen = t - st.openT;
    const pulled = sinceOpen < 0.55 ? easeOutBack(sinceOpen / 0.14) : 1 - smooth((sinceOpen - 0.55) / 0.8);
    st.open = Math.max(0.42 + flow * 0.3, clamp(pulled, 0, 1.15));
    const bellyNow = st.belly * Math.exp(-(t - st.bellyT) * 1.6);
    st.flut = damp(st.flut, Math.max(near, nearCross * 1.3) + (Math.abs(bellyNow) < 0.15 && sinceOpen < 0.8 ? 0.6 : 0), 6, dt);
    for (let i = 0; i < 4; i++) {
      const s = S.sails[i];
      s.u.uOpen.value = st.open; s.u.uFlut.value = st.flut * (0.8 + 0.2 * Math.sin(i * 3)); s.u.uBelly.value = bellyNow + Math.max(0, st.omega) * 0.04;
      for (let k = 0; k < s.slats.length; k++) s.slats[k].rotation.y = lerp(1.25, 0.05, clamp(st.open)) + Math.sin(t * 13 + k) * st.flut * 0.12;
      if (s.pennant) { const pa = s.pennant.rotation; pa.z = Math.sin(t * 9) * 0.25 * (0.3 + st.flut); }
    }
    // the vane on the finial follows the wind, flapping harder as gusts near
    { const a = S.vaneG.attributes.position, base = S.vaneBase, dir = nearCross > near ? -1 : 1;
      for (let i = 0; i < a.count; i++) { const x = base[i * 3]; a.setX(i, x * dir); a.setZ(i, Math.sin(t * 10 + x * 6) * (0.03 + Math.max(near, nearCross) * 0.12) * (-x)); }
      a.needsUpdate = true; }
    // the keeper: watches the meadow, pulls, sits when all is still
    const K = S.keeper;
    K.pull = damp(K.pull, 0, 5, dt);
    S.lever.rotation.z = 0.5 - K.pull * 0.9;
    K.look = damp(K.look, near > 0.05 ? -1.1 : nearCross > 0.05 ? 0.9 : -0.2 + Math.sin(t * 0.3) * 0.3, 3, dt);
    if (t - st.lastCatch > 14 && st.omega < 0.4 && G.playing) { if (K.sit < 0.5) audio.stillness(t); K.sit = damp(K.sit, 1, 2, dt); } else K.sit = damp(K.sit, 0, 4, dt);
    K.cheer = damp(K.cheer, st.finale ? 0.5 + 0.5 * Math.sin(t * 6) : 0, 4, dt);
    if (K.hatOff > 0 && t - st.hatT > 3.2) K.hatOff = 0;
    K.update(dt);
    S.mender.armR.rotation.x = -1.2 + Math.abs(Math.sin(t * 3.2)) * 0.6; S.mender.update(dt);
    S.mender.armR.rotation.x = -1.2 + Math.abs(Math.sin(t * 3.2)) * 0.6;

    // pump: two strokes a turn while engaged and turning fast enough
    const engaged = L.pump && st.omega > 0.75;
    const sn = Math.sin(st.theta * 2);
    S.rod.position.y = 3.75 + (L.pump ? sn * 0.2 : 0);
    S.clutch.rotation.z = L.pump ? st.theta * 2 : 0;
    let spout = 0;
    if (engaged && st.prevSin > 0 && sn <= 0) {
      const vol = 0.058 * clamp((st.omega - 0.6) / 2.2, 0.2, 1);
      st.water += vol; st.strokes++;
      audio.chuff(t, clamp(st.omega / 3));
      audio.drip(t + 0.15, Math.floor(clamp(st.water) * 9));
      st.spoutT = t;
    }
    st.prevSin = sn;
    if (st.spoutT !== undefined) spout = clamp(1 - (t - st.spoutT) / 0.7);
    S.spoutMat.uniforms.uOp.value = spout * 0.9; S.spoutMat.uniforms.uT.value = t;
    // cistern out to the wheel
    let out = 0;
    if (L.sluice && st.water > 0.004) { out = (0.024 + st.water * 0.02) * dt; st.water -= out; }
    if (st.water > 1) { st.spill = 1; st.water = 1; if (Math.random() < dt * 3) audio.splash(t, 0.5); }
    st.spill = damp(st.spill, 0, 1.2, dt);
    st.water = Math.max(0, st.water);
    S.cisternWater.position.y = 4.18 + st.water * 1.0; S.cisternWater.visible = st.water > 0.01;
    S.waterTopMat.uniforms.uT.value = t; S.waterTopMat.uniforms.uFlow.value = spout + 0.2;
    S.spillMat.uniforms.uOp.value = st.spill * 0.85; S.spillMat.uniforms.uT.value = t;
    const flowing = L.sluice && st.water > 0.01;
    const outRate = flowing ? clamp(st.water * 6, 0.3, 1) : 0;
    st.outflow = damp(st.outflow || 0, outRate, 3, dt);
    S.troughMat.uniforms.uOp.value = st.outflow * 0.92; S.troughMat.uniforms.uT.value = t;
    S.fallMat.uniforms.uOp.value = st.outflow * 0.88; S.fallMat.uniforms.uT.value = t;
    S.streamMat.uniforms.uT.value = t; S.streamMat.uniforms.uFlow.value = 0.25 + st.outflow * 0.9;

    // the wheel: turns with water; its cam kicks the lift. When the world is in
    // flow the wheel quietly settles onto the same pulse as the wind.
    const camPeriod = 3 * beat;
    const target = flowing ? (Math.PI / camPeriod) * clamp(st.water / 0.12, 0.45, 1) : 0;
    st.wheelW = damp(st.wheelW, target, flowing ? 1.2 : 0.7, dt);
    if (flowing && st.water > 0.12 && flow > 0.3) {
      const want = ((t - G.t0) / camPeriod) * Math.PI + Math.PI * 0.5;
      let e = (st.wheelA - want) % Math.PI; if (e > Math.PI / 2) e -= Math.PI; if (e < -Math.PI / 2) e += Math.PI;
      st.wheelW -= e * 0.6 * dt;
    }
    const prevA = st.wheelA; st.wheelA += st.wheelW * dt;
    S.wheel.rotation.z = -st.wheelA;
    if (Math.floor(st.wheelA / Math.PI) !== Math.floor(prevA / Math.PI) && st.wheelW > 0.2) {
      // a cam fires: the winch jerks
      st.winchKick = t;
      audio.knock(t, 0.55, 0.6);
      if (L.lift && st.critter.s === 'riding' && st.liftMode === 'idle' && st.n < st.N) kick(G);
      else if (Math.random() < 0.5) audio.drip(t, 2 + (Math.random() * 3 | 0));
    }
    const wk = st.winchKick ? clamp(1 - (t - st.winchKick) / 0.5) : 0;
    S.winch.rotation.x = -easeOutCubic(1 - wk) * 0.0 - wk * 0.9;
    // pushrod between wheel crank and winch
    { const a = new THREE.Vector3(4.1 + Math.cos(-st.wheelA) * 0.35, 1.55 + Math.sin(-st.wheelA) * 0.35, 2.15), b = new THREE.Vector3(S.LX - 0.55, 0.55 + 0.25 * Math.cos(S.winch.rotation.x), S.LZ + 0.75);
      S.pushrod.position.copy(a).add(b).multiplyScalar(0.5); S.pushrod.scale.x = a.distanceTo(b); S.pushrod.rotation.z = Math.atan2(b.y - a.y, b.x - a.x); S.pushrod.visible = L.lift; }

    // lift
    updateLift(dt, G);
    updateCritter(dt, G);

    // greenhouse glow, garden blooms, lanterns: the world brightens with flow
    const glow = clamp(st.deliveries / 3) * 0.6 + (st.finale ? 0.4 : 0);
    S.glassM.emissiveIntensity = damp(S.glassM.emissiveIntensity, glow * 0.35, 2, dt);
    S.lamp.material.opacity = damp(S.lamp.material.opacity, glow * 0.55, 2, dt);
    for (const f of S.garden) f.set(damp(f.v, flow > f.thr || st.finale ? 1 : 0, flow > f.thr ? 1.2 : 0.4, dt));
    for (let i = 0; i < S.lanterns.length; i++) S.lanterns[i].material.opacity = damp(S.lanterns[i].material.opacity, flow > 0.55 + i * 0.12 || st.finale ? 0.75 + Math.sin(t * 3 + i) * 0.1 : 0, 2, dt);
    S.bell.update(dt);
    S.birds.update(dt, t);
    S.smoke.update(dt, 0.3 + near);
    S.clouds.userData.update(dt, near * 0.5 + flow * 0.3);
    S.pawl.rotation.z = damp(S.pawl.rotation.z, 0, 6, dt);
  };

  function kick(G) {
    const tA = G.beat; // rise for one beat
    const h = ((7.62 - 0.12) / st.N) * 1.22;
    const g = 2 * h / (tA * tA);
    st.bounce = { t0: G.t, hb: notchY(st.n), g, v0: g * tA, op: G.addOp('apex', G.t + tA, {}), slip: false };
    st.liftMode = 'bounce';
    audio.ratchet(G.t); audio.ratchet(G.t + 0.06);
  }
  function updateLift(dt, G) {
    const t = G.t;
    if (st.liftMode === 'bounce') {
      const b = st.bounce, tau = t - b.t0;
      st.liftY = b.hb + b.v0 * tau - 0.5 * b.g * tau * tau;
      if (st.liftY <= b.hb && tau > 0.1) { st.liftY = b.hb; st.liftMode = 'settle'; st.liftT = t; st.liftV = -1.2; st.bounce = null; audio.knock(t, 0.9, 0.7); }
    } else if (st.liftMode === 'settle') {
      const ty = notchY(st.n);
      st.liftV += (ty - st.liftY) * 120 * dt - st.liftV * 10 * dt; st.liftY += st.liftV * dt;
      if (t - st.liftT > 0.6) { st.liftY = ty; st.liftMode = st.n >= st.N ? 'top' : 'idle'; }
    } else if (st.liftMode === 'descend') {
      st.liftY -= dt * 2.1;
      if (Math.floor(st.liftY * 3) !== Math.floor((st.liftY + dt * 2.1) * 3)) audio.ratchet(t, 0.6);
      if (st.liftY <= notchY(0)) { st.liftY = notchY(0); st.n = 0; st.liftMode = 'idle'; audio.knock(t, 0.8, 0.8); }
    } else if (st.liftMode === 'top' || st.liftMode === 'idle') st.liftY = damp(st.liftY, notchY(st.n), 8, dt);
    S.cage.position.set(S.LX, st.liftY, S.LZ);
    S.cage.visible = st.L.lift || st.L.n >= 3;
    const top = 8.85 - 0.72;
    S.rope1.position.set(S.LX + 0.72, (st.liftY + 1.0 + top) / 2, S.LZ); S.rope1.scale.y = Math.max(0.05, top - st.liftY - 1.0);
    const wy = 0.6 + (7.62 - st.liftY) * 0.9;
    S.weight.position.set(S.LX - 0.72, wy, S.LZ - 0.1);
    S.rope2.position.set(S.LX - 0.72, (wy + 0.25 + top) / 2, S.LZ - 0.1); S.rope2.scale.y = Math.max(0.05, top - wy - 0.25);
    S.pulley.rotation.z = -st.liftY * 1.3;
  }

  // the lantern-bearer's errand
  function walkTo(c, target, dt, speed = 0.95) {
    _p.copy(target).sub(c.pos); _p.y = 0; const d = _p.length();
    if (d < 0.04) return true;
    const stp = Math.min(d, speed * dt); c.pos.addScaledVector(_p.normalize(), stp);
    S.critter.group.rotation.y = damp(S.critter.group.rotation.y, Math.atan2(_p.x, _p.z), 10, dt);
    return false;
  }
  function updateCritter(dt, G) {
    const c = st.critter, t = G.t, L = st.L; let moving = false;
    c.t += dt;
    const CR = S.critter;
    if (!L.lift) { // before the lift is in use, the bearer waits by the basket, watching
      c.pos.copy(S.basket).add(_q.set(0.35, 0, 0.1)); CR.look = -0.25; CR.group.rotation.y = damp(CR.group.rotation.y, -0.6, 3, dt);
      CR.hasSeed = true; CR.hop = Math.max(0, Math.sin(t * 4)) * 0.03 * (st.omega > 1.5 ? 1 : 0);
    } else switch (c.s) {
      case 'basket': CR.hasSeed = c.t > 0.5; if (c.t > 1.0) { c.s = 'toLift'; c.t = 0; } break;
      case 'toLift': {
        const door = S.liftDoor;
        if (walkTo(c, door, dt)) { if (st.liftMode === 'idle' && st.n === 0 && st.liftY < 0.3) { c.s = 'board'; c.t = 0; } else { CR.look = -0.4; CR.hop = Math.max(0, Math.sin(t * 6)) * 0.03; } }
        else moving = true;
        break;
      }
      case 'board': c.pos.lerp(_q.set(S.LX, 0, S.LZ), clamp(c.t * 3)); CR.hop = Math.sin(clamp(c.t * 2) * Math.PI) * 0.25; if (c.t > 0.5) { c.s = 'riding'; c.t = 0; CR.hop = 0; } moving = true; break;
      case 'riding': c.pos.set(S.LX, st.liftY + 0.05, S.LZ); CR.group.rotation.y = damp(CR.group.rotation.y, 0, 4, dt); CR.look = st.liftMode === 'bounce' ? -0.2 : 0;
        if (st.liftMode === 'top') { c.s = 'out'; c.t = 0; c.path = [new THREE.Vector3(S.LX - 0.2, 7.67, -0.3), new THREE.Vector3(S.ghDoor.x, 7.67, S.ghDoor.z), S.pots[st.potK % 6].clone().setY(7.85).add(_q.set(0, 0, 0.3))]; c.pi = 0; }
        break;
      case 'out': {
        const tg = c.path[c.pi]; c.pos.y = damp(c.pos.y, tg.y, 8, dt);
        if (walkTo(c, tg, dt, 0.85)) { c.pi++; if (c.pi >= c.path.length) { c.s = 'plant'; c.t = 0; } } else moving = true;
        break;
      }
      case 'plant':
        CR.look = 0.4 * Math.sin(clamp(c.t / 1.2) * Math.PI);
        if (c.t > 0.6 && CR.hasSeed) { CR.hasSeed = false; deliver(G); }
        if (c.t > 1.6) { c.s = 'back'; c.t = 0; c.path = [new THREE.Vector3(S.ghDoor.x, 7.67, S.ghDoor.z), new THREE.Vector3(S.LX - 0.2, 7.67, -0.3), new THREE.Vector3(S.LX, 7.67, S.LZ)]; c.pi = 0; }
        break;
      case 'back': {
        const tg = c.path[c.pi];
        if (walkTo(c, tg, dt, 1.1)) { c.pi++; if (c.pi >= c.path.length) { c.s = 'down'; c.t = 0; st.liftMode = 'descend'; } } else moving = true;
        break;
      }
      case 'down': c.pos.set(S.LX, st.liftY + 0.05, S.LZ); if (st.liftMode === 'idle' && st.n === 0) { c.s = 'toBasket'; c.t = 0; } break;
      case 'toBasket': if (walkTo(c, S.basket, dt)) { c.s = 'basket'; c.t = 0; } else moving = true; c.pos.y = 0; break;
    }
    CR.group.position.copy(c.pos);
    CR.update(dt, moving);
  }
  function deliver(G) {
    const t = G.t;
    const f = S.flowers[st.potK % 6]; st.potK++;
    st.deliveries++;
    const fl = { f, t0: t };
    st.blooming = fl;
    S.bell.ring(1);
    audio.bloom(t); audio.bell(t + 0.3, 4 + (st.deliveries % 3) * 2, 1);
    audio.chirp(t + 0.5, 4);
    S.birds.startle(S.bell.group.position, 20);
    audio.setChord(st.deliveries % 4);
    G.event('delivery', { pos: S.pots[0] });
    G.focus(S.bell.group.position, 0.3);
    // the flower opens over a second and a half
    const grow = () => { };
    st.bloomList = st.bloomList || []; st.bloomList.push(fl);
  }
  // bloom animation runs in its own tiny loop
  const _upd = W.update;
  W.update = (dt, G) => {
    _upd(dt, G);
    if (st.bloomList) for (const b of st.bloomList) b.f.set(Math.max(b.f.v, clamp((G.t - b.t0) / 1.6)));
  };

  W.audioState = (G) => ({ wind: 0.25 + (st.flut || 0) * 0.6, water: (st.outflow || 0) * 0.8 + (st.spill || 0) * 0.5, hum: st.liftMode === 'bounce' || st.liftMode === 'descend' ? 1 : 0, humPitch: st.liftY / 7.6, bloom: clamp(st.deliveries / 4) });
  W.finale = (G) => { st.finale = true; S.bell.ring(1.5); audio.bell(G.t + 0.2, 7, 1); audio.swell(G.t, 3); S.birds.startle(S.hub, 30); };
  W.endFinale = () => { if (st) st.finale = false; };
  // a point the camera may lean toward when something happens
  W.points = () => ({ hub: S.hub, lift: new THREE.Vector3(S.LX, st ? st.liftY : 0, S.LZ), greenhouse: S.bell.group.position });
  return W;
}
