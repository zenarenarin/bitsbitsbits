// WORLD II — THE CLOCK TOWER
// A pendulum hangs in the arch. Push it at the end of its swing and it keeps
// swinging; push it too often and it bangs against the frame. While it swings,
// the escapement ticks the hands forward and steps a great wheel round. Catch the
// wheel's coral pointer at the top to wind the bell weight. Each quarter hour, a
// wound weight lets the hammer fall: the bell rings and a small automaton bird
// comes out to see. Gusts from the windmill country blow through the arch.
function createClockWorld(THREE, P, E, X, audio) {
  const W = { id: 'clock', numeral: 'II', name: 'The Clock Tower', label: 'CLOCK TOWER', bpm: 72 };
  W.look = {
    sky: { top: '#6fb2d8', mid: '#a9d4e6', horizon: '#f3ead6', sun: '#ffe3b0', sunDir: [0.55, 0.38, -0.7] },
    fog: '#efe7d6', fogNear: 36, fogFar: 175, hemiSky: '#e3ecef', hemiGround: '#b0a070', hemi: 1.0, sunColor: '#ffe6c2', sun: 1.7, sunPos: [16, 22, 18]
  };
  W.frame = { x0: -6.2, x1: 7.0, y0: -0.6, y1: 17.6, cy: 8.2, z: 0, dist: 34 };
  W.dailyTitles = ['Keep the town on time', 'Every quarter, a bell', 'A windy afternoon'];
  const C = {
    stone: 0xe9e1cf, stone2: 0xd8ccb2, stoneDark: 0xb8a88c, plaster: 0xf5eedd, roof: 0xd9876a, roofDark: 0xb86a52, wood: 0x9c7552, woodDark: 0x6b4f3a, woodLight: 0xc19a6b,
    brass: 0xc8a35e, copper: 0xb8774f, rust: 0xc0693f, coral: 0xe0705a, slate: 0x5b7b92, moss: 0x8aa35c, cream: 0xf6efdc, face: 0xf7f1e2
  };
  // amp goal / minutes / weight notches / chimes
  W.levels = [
    { n: 1, title: 'Wake the pendulum', note: 'A swing is easiest to push at the end of its arc.', goal: { type: 'amp' }, escape: false, wheel: false, chimes: false, gusts: 0, win: [0.11, 0.25], startA: 0.12, start: 660, par: 25 },
    { n: 2, title: 'Set the hands moving', note: 'Keep it swinging and the hands keep time.', goal: { type: 'minutes', need: 10 }, escape: true, wheel: false, chimes: false, gusts: 0, win: [0.105, 0.24], startA: 0.5, start: 660, par: 30 },
    { n: 3, title: 'Wind the bell weight', note: 'The coral pointer comes round. Catch it at the top.', goal: { type: 'weight', need: 6 }, escape: true, wheel: true, chimes: false, gusts: 0, win: [0.1, 0.23], startA: 0.6, start: 600, par: 45 },
    { n: 4, title: 'Ring the hour', note: 'The hammer only falls if the weight is wound.', goal: { type: 'chimes', need: 1 }, escape: true, wheel: true, chimes: true, gusts: 0, win: [0.1, 0.22], startA: 0.6, start: 710, weight: 2, par: 45 },
    { n: 5, title: 'A wind through the arch', note: 'The wind does not keep time. You do.', goal: { type: 'chimes', need: 1 }, escape: true, wheel: true, chimes: true, gusts: 0.5, win: [0.095, 0.21], startA: 0.6, start: 705, weight: 1, par: 55 },
    { n: 6, title: 'Keep the quarters', note: 'Every quarter hour wants its bell.', goal: { type: 'chimes', need: 2 }, escape: true, wheel: true, chimes: true, gusts: 0.35, win: [0.09, 0.2], startA: 0.6, start: 5, weight: 2, wheelBeats: 5, par: 70 },
    { n: 7, title: 'Keep time', note: 'Until the light changes.', goal: { type: 'timed', secs: 100 }, escape: true, wheel: true, chimes: true, gusts: 0.4, win: [0.085, 0.19], startA: 0.6, start: 175, weight: 2, wheelBeats: 5, par: 100 }
  ];
  const root = new THREE.Group(); W.root = root;
  const S = {}; let built = false;
  const U = { t: { value: 0 } };

  W.build = (scene) => {
    scene.add(root);
    if (built) return; built = true;
    const mat = P.mat({ brush: 0.14, scale: 1.6 }), matFine = P.mat({ brush: 0.08, scale: 3.5 });
    const ink = P.ink(0x3a3431, 0.03), inkThin = P.ink(0x3a3431, 0.016);
    const pathAt = (x, z) => (z > 1.8 ? smooth(1 - Math.abs(x - Math.sin(z * 0.2) * 0.8) / 1.0) * 0.85 : 0);
    const ground = E.ground({ grass: 0xa8b56c, grass2: 0xb9bf78, dry: 0xd2c28a, path: 0xdccaa0, pathAt, flat: 14, rise: 8 });
    root.add(ground); S.heightAt = ground.userData.heightAt;

    // ---------- the tower ----------
    const tw = new P.Builder(201), rr = makeRng(202);
    const block = (x0, x1, y0, y1, z, d = 0.5, col) => {
      for (let y = y0; y < y1 - 0.01;) {
        const h = Math.min(y1 - y, rr.range(0.45, 0.7));
        for (let x = x0; x < x1 - 0.01;) { const w = Math.min(x1 - x, rr.range(0.6, 1.2)); tw.add(new THREE.BoxGeometry(w - 0.03, h - 0.03, d), col || (rr() < 0.18 ? C.stone2 : C.stone), { p: [x + w / 2, y + h / 2, z] }, { jitter: 0.03, vary: 0.04, shade: 0.06 }); x += w; }
        y += h;
      }
    };
    // core walls (solid, behind the facing blocks)
    tw.add(new THREE.BoxGeometry(1.1, 9, 3.4), C.stone, { p: [-1.75, 4.5, -0.15] }, { shade: 0.15 });
    tw.add(new THREE.BoxGeometry(1.1, 9, 3.4), C.stone, { p: [1.75, 4.5, -0.15] }, { shade: 0.15 });
    tw.add(new THREE.BoxGeometry(2.4, 4.35, 3.4), C.stone, { p: [0, 6.82, -0.15] }, { shade: 0.15 });
    tw.add(new THREE.BoxGeometry(2.4, 4.7, 0.3), C.stone, { p: [0, 2.35, -1.75] }, { shade: 0.15 });
    // front face with the arch cut
    block(-2.3, -1.2, 0, 9, 1.65, 0.3); block(1.2, 2.3, 0, 9, 1.65, 0.3); block(-1.2, 1.2, 4.6, 9, 1.65, 0.3);
    // arch voussoirs
    for (let k = 0; k <= 10; k++) { const a = Math.PI * (k / 10); tw.add(new THREE.BoxGeometry(0.32, 0.5, 0.42), k % 2 ? C.stone2 : C.stone, { p: [Math.cos(a) * 1.38, 3.45 + Math.sin(a) * 1.38, 1.72], r: [0, 0, a - Math.PI / 2] }, { jitter: 0.02 }); }
    tw.add(new THREE.BoxGeometry(0.42, 0.62, 0.48), C.stone2, { p: [0, 4.9, 1.75] });
    // the arch's dark interior and its machinery
    tw.add(new THREE.BoxGeometry(2.4, 4.6, 0.1), 0x5a4838, { p: [0, 2.3, -1.4] }, { vary: 0, shade: 0.45 });
    tw.add(new THREE.BoxGeometry(0.1, 4.6, 3.0), 0x4a3f38, { p: [-1.2, 2.3, 0.1] }, { vary: 0 }); tw.add(new THREE.BoxGeometry(0.1, 4.6, 3.0), 0x4a3f38, { p: [1.2, 2.3, 0.1] }, { vary: 0 });
    tw.add(new THREE.BoxGeometry(2.4, 0.1, 3.0), 0x4a3f38, { p: [0, 4.62, 0.1] }, { vary: 0 });
    // steps to the arch
    for (let k = 0; k < 3; k++) tw.add(new THREE.BoxGeometry(2.8 - k * 0.3, 0.16, 0.5), C.stoneDark, { p: [0, 0.08 + k * 0.16, 2.6 - k * 0.38] }, { jitter: 0.03 });
    // a round window with a gear behind it
    tw.add(new THREE.TorusGeometry(0.42, 0.09, 6, 16), C.brass, { p: [-1.1, 6.6, 1.82] });
    tw.add(new THREE.CircleGeometry(0.4, 16), 0x3e3530, { p: [-1.1, 6.6, 1.8] }, { vary: 0, shade: 0 });
    tw.add(P.gearGeo(0.32, 10, 0.06, { hole: 0.06 }), C.copper, { p: [-1.1, 6.6, 1.78] });
    // quoins
    for (let y = 0.3; y < 9; y += 0.62) for (const sx of [-1, 1]) tw.add(new THREE.BoxGeometry(0.5, 0.5, 0.5), rr() < 0.4 ? C.stone2 : C.stone, { p: [sx * 2.22, y, 1.55], r: [0, rr.range(-0.05, 0.05), 0] }, { jitter: 0.04 });
    // ledge on brackets
    tw.add(new THREE.BoxGeometry(5.3, 0.16, 2.0), C.woodLight, { p: [0, 9.05, 1.0] });
    for (const x of [-2.1, -0.7, 0.7, 2.1]) { tw.add(new THREE.BoxGeometry(0.16, 0.6, 0.16), C.woodDark, { p: [x, 8.75, 1.6] }); tw.add(new THREE.BoxGeometry(0.12, 0.9, 0.12), C.woodDark, { p: [x, 8.55, 1.2], r: [0.75, 0, 0] }); }
    // clock housing
    tw.add(new THREE.BoxGeometry(3.9, 4.2, 3.0), C.plaster, { p: [0, 11.2, -0.2] }, { jitter: 0.04, shade: 0.1 });
    tw.add(new THREE.BoxGeometry(4.1, 0.22, 3.2), C.stone2, { p: [0, 13.25, -0.2] }, { jitter: 0.03 });
    tw.add(new THREE.CylinderGeometry(1.95, 1.95, 0.25, 32), C.brass, { p: [0, 11.3, 1.32], r: [Math.PI / 2, 0, 0] });
    // the automaton's door under the face
    tw.add(new THREE.BoxGeometry(0.5, 0.42, 0.06), C.slate, { p: [0, 9.42, 1.33] });
    // roof: dusty coral tiles, wide eaves
    const roof = new THREE.ConeGeometry(3.6, 2.0, 4, 1); roof.rotateY(Math.PI / 4);
    tw.add(roof, C.roof, { p: [0, 14.35, -0.2], s: [1, 1, 0.95] }, { shade: 0.25, top: 0xe8a080, topAmt: 0.3 });
    for (let k = 0; k < 9; k++) tw.add(new THREE.BoxGeometry(5.0 - k * 0.52, 0.05, 0.1), C.roofDark, { p: [0, 13.48 + k * 0.21, 2.35 - k * 0.24], r: [0.65, 0, 0] }, { vary: 0.03 });
    // cupola
    for (const [x, z] of [[-0.45, -0.65], [0.45, -0.65], [-0.45, 0.25], [0.45, 0.25]]) tw.add(new THREE.BoxGeometry(0.16, 1.1, 0.16), C.plaster, { p: [x, 15.65, z] });
    tw.add(new THREE.BoxGeometry(1.2, 0.14, 1.2), C.stone2, { p: [0, 15.1, -0.2] });
    const cr = new THREE.ConeGeometry(0.95, 0.75, 4, 1); cr.rotateY(Math.PI / 4);
    tw.add(cr, C.roof, { p: [0, 16.55, -0.2] }, { shade: 0.2 });
    tw.add(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 4), C.brass, { p: [0, 17.2, -0.2] });
    tw.add(new THREE.BoxGeometry(0.34, 0.04, 0.04), C.brass, { p: [0, 17.35, -0.2] });
    root.add(tw.mesh(mat, ink));
    // clock face
    const faceTex = P.canvas(512, 512, (g, w) => {
      const c = w / 2;
      g.fillStyle = '#f6efde'; g.beginPath(); g.arc(c, c, c - 4, 0, TAU); g.fill();
      g.strokeStyle = '#3b3632'; g.lineWidth = 3; g.beginPath(); g.arc(c, c, c - 22, 0, TAU); g.stroke();
      g.lineWidth = 1.5; g.beginPath(); g.arc(c, c, c - 78, 0, TAU); g.stroke();
      for (let i = 0; i < 60; i++) { const a = i / 60 * TAU; const r0 = c - 22, r1 = c - (i % 5 ? 32 : 44); g.lineWidth = i % 5 ? 1.5 : 3; g.beginPath(); g.moveTo(c + Math.sin(a) * r0, c - Math.cos(a) * r0); g.lineTo(c + Math.sin(a) * r1, c - Math.cos(a) * r1); g.stroke(); }
      g.fillStyle = '#3b3632'; g.font = '44px Georgia, serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let h = 1; h <= 12; h++) { const a = h / 12 * TAU, r = c - 64; g.save(); g.translate(c + Math.sin(a) * r, c - Math.cos(a) * r); g.rotate(a); g.fillText(ROMAN[h], 0, 0); g.restore(); }
      const spots = [[0.3, -0.2, 26], [0.15, 0.35, 18], [-0.3, 0.1, 14], [0.45, 0.25, 12]];
      for (const [x, y, r] of spots) { g.fillStyle = 'rgba(224,128,84,0.85)'; g.beginPath(); g.arc(c + x * c, c + y * c, r, 0, TAU); g.fill(); }
      g.strokeStyle = 'rgba(59,54,50,0.35)'; g.lineWidth = 1; for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(c, c, 40 + k * 22, 0, TAU); g.stroke(); }
    });
    const face = new THREE.Mesh(new THREE.CircleGeometry(1.72, 48), new THREE.MeshLambertMaterial({ map: faceTex })); face.position.set(0, 11.3, 1.46); root.add(face);
    const hand = (len, w, col) => { const g = new THREE.Group(); const b = new P.Builder(len * 10 | 0); b.add(new THREE.BoxGeometry(w, len, 0.04), col, { p: [0, len / 2 - 0.15, 0] }); b.add(new THREE.ConeGeometry(w * 1.6, 0.22, 4), col, { p: [0, len - 0.05, 0] }); g.add(b.mesh(matFine, null)); g.position.set(0, 11.3, 1.52); root.add(g); return g; };
    S.hourHand = hand(1.0, 0.09, 0x3b3632); S.minHand = hand(1.45, 0.06, C.rust); S.minHand.position.z = 1.56;
    { const b = new P.Builder(210); b.add(new THREE.CylinderGeometry(0.1, 0.1, 0.1, 10), C.brass, { r: [Math.PI / 2, 0, 0] }); const m = b.mesh(matFine, null); m.position.set(0, 11.3, 1.6); root.add(m); }
    // gears around the face (they step with every tick)
    S.gears = [];
    for (const [x, y, r, n, col] of [[-1.85, 12.85, 0.55, 12, C.copper], [1.95, 9.95, 0.5, 11, C.brass], [-2.05, 9.85, 0.38, 9, C.rust], [1.6, 13.0, 0.36, 9, C.brass]]) {
      const b = new P.Builder(n * 3); b.add(P.gearGeo(r, n, 0.12, { hole: r * 0.2, windows: 4 }), col, {}); b.add(new THREE.CylinderGeometry(r * 0.22, r * 0.22, 0.2, 8), C.woodDark, { r: [Math.PI / 2, 0, 0] });
      const m = b.mesh(matFine, inkThin); m.position.set(x, y, 1.42); root.add(m); S.gears.push({ m, r });
    }
    // ---------- the pendulum ----------
    S.pend = new THREE.Group(); S.pend.position.set(0, 4.42, 0.3); root.add(S.pend);
    { const b = new P.Builder(220);
      b.add(new THREE.BoxGeometry(0.07, 2.4, 0.07), C.brass, { p: [0, -1.2, 0] });
      b.add(new THREE.BoxGeometry(0.34, 0.12, 0.2), C.woodDark, { p: [0, 0, 0] });
      b.add(new THREE.CylinderGeometry(0.4, 0.4, 0.14, 24), 0xd9b56a, { p: [0, -2.45, 0], r: [Math.PI / 2, 0, 0] });
      b.add(new THREE.TorusGeometry(0.4, 0.045, 6, 24), C.copper, { p: [0, -2.45, 0.07] });
      b.add(new THREE.CylinderGeometry(0.13, 0.13, 0.16, 10), C.coral, { p: [0, -2.45, 0.08], r: [Math.PI / 2, 0, 0] });
      S.pend.add(b.mesh(matFine, inkThin)); }
    // stops on either side of the arch: the pendulum bangs these if pushed too hard
    S.stops = [];
    for (const sx of [-1, 1]) { const b = new P.Builder(230 + sx); b.add(new THREE.BoxGeometry(0.16, 0.5, 0.3), C.woodDark, {}); b.add(new THREE.BoxGeometry(0.1, 0.3, 0.32), C.coral, { p: [-sx * 0.1, 0, 0] }); const m = b.mesh(matFine, null); m.position.set(sx * 1.1, 2.15, 0.3); root.add(m); S.stops.push(m); }
    // the pusher: a little arm on each side that nudges the bob
    S.pushers = [];
    for (const sx of [-1, 1]) { const g = new THREE.Group(); g.position.set(sx * 1.13, 1.55, 0.5); const b = new P.Builder(240 + sx); b.add(new THREE.BoxGeometry(0.5, 0.07, 0.07), C.brass, { p: [-sx * 0.25, 0, 0] }); b.add(new THREE.SphereGeometry(0.07, 6, 4), C.coral, { p: [-sx * 0.5, 0, 0] }); g.add(b.mesh(matFine, null)); root.add(g); S.pushers.push({ g, sx, t: -9 }); }
    S.archGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffc777, transparent: true, opacity: 0.55, depthWrite: false })); S.archGlow.position.set(0, 2.6, -1.1); S.archGlow.scale.set(3.4, 3.4, 1); root.add(S.archGlow);
    // back gears inside the arch
    for (const [x, y, r, n] of [[0.55, 3.6, 0.42, 10], [-0.6, 3.9, 0.3, 8]]) { const b = new P.Builder(n * 7); b.add(P.gearGeo(r, n, 0.1, { hole: r * 0.2 }), C.copper, {}); const m = b.mesh(matFine, null); m.position.set(x, y, -1.25); root.add(m); S.gears.push({ m, r, back: true }); }
    // ---------- the great wheel ----------
    S.wheel = new THREE.Group(); S.wheel.position.set(3.25, 10.7, 0.95); root.add(S.wheel);
    { const b = new P.Builder(250); P.wheel(b, C.rust, {}, 1.85, 10, 0.16, { rim: 0.11, hubColor: C.brass });
      b.add(new THREE.TorusGeometry(1.55, 0.04, 4, 30), C.brass, {});
      for (let k = 0; k < 40; k++) { const a = k / 40 * TAU; b.add(new THREE.BoxGeometry(0.14, 0.18, 0.15), C.copper, { p: [Math.cos(a) * 1.98, Math.sin(a) * 1.98, 0], r: [0, 0, a] }); }
      S.wheel.add(b.mesh(matFine, inkThin)); }
    S.pointer = new THREE.Group(); S.wheel.add(S.pointer);
    { const b = new P.Builder(251); b.add(new THREE.BoxGeometry(0.1, 0.9, 0.08), C.coral, { p: [0, 1.35, 0.12] }); b.add(new THREE.ConeGeometry(0.2, 0.42, 3), C.coral, { p: [0, 1.95, 0.12] }); S.pointer.add(b.mesh(matFine, inkThin)); }
    // pawl at the top that catches the pointer
    S.pawl = new THREE.Group(); S.pawl.position.set(3.25, 12.95, 1.15); root.add(S.pawl);
    { const b = new P.Builder(252); b.add(new THREE.BoxGeometry(0.1, 0.55, 0.1), C.brass, { p: [0, -0.22, 0] }); b.add(new THREE.SphereGeometry(0.08, 6, 4), C.coral, { p: [0, -0.5, 0] }); S.pawl.add(b.mesh(matFine, inkThin)); }
    { const b = new P.Builder(253);
      b.add(new THREE.BoxGeometry(0.3, 0.3, 0.8), C.woodDark, { p: [3.25, 13.05, 0.75] }); b.add(new THREE.BoxGeometry(1.4, 0.18, 0.18), C.woodDark, { p: [2.6, 13.05, 0.4] });
      b.add(new THREE.BoxGeometry(0.2, 0.2, 1.3), C.woodDark, { p: [3.25, 10.7, 0.3] });
      // pipes down the right side, with a drip at the end
      b.add(P.tube([[2.3, 10.2, 0.6], [2.9, 9.0, 0.95], [3.1, 6.0, 1.05], [3.1, 2.5, 1.05], [2.9, 1.5, 1.2], [2.6, 1.25, 1.6]], 0.13, 40, 7), C.copper, {});
      b.add(P.tube([[2.35, 8.0, 1.2], [2.8, 7.5, 1.25], [3.55, 7.4, 1.2], [3.85, 7.0, 1.2]], 0.1, 24, 6), C.brass, {});
      for (const y of [8.4, 5.5, 3.0]) b.add(new THREE.TorusGeometry(0.17, 0.05, 4, 10), C.slate, { p: [3.08, y, 1.05], r: [Math.PI / 2, 0, 0] });
      root.add(b.mesh(matFine, inkThin)); }
    S.dripSpot = new THREE.Vector3(3.85, 6.9, 1.2);
    S.drip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: 0x8fd0cc, fog: true })); root.add(S.drip);
    // ---------- the bell weight on its chain ----------
    S.wPulley = new THREE.Group(); S.wPulley.position.set(-2.75, 8.75, 1.3); root.add(S.wPulley);
    { const b = new P.Builder(260); P.wheel(b, C.brass, {}, 0.32, 6, 0.08, { rim: 0.05 }); S.wPulley.add(b.mesh(matFine, null)); }
    { const b = new P.Builder(261); b.add(new THREE.BoxGeometry(0.6, 0.12, 0.12), C.woodDark, { p: [-2.45, 8.75, 1.3] });
      // notch marks on the wall, the weight's measure
      for (let k = 0; k <= 6; k++) b.add(new THREE.BoxGeometry(0.22, 0.05, 0.02), k % 3 ? 0x8a7a68 : C.coral, { p: [-2.42, 1.4 + k * 1.0, 1.68] }, { vary: 0 });
      root.add(b.mesh(matFine, null)); }
    S.weightM = new THREE.Mesh((() => { const b = new P.Builder(262); b.add(new THREE.CylinderGeometry(0.22, 0.26, 0.6, 8), C.stoneDark, {}); b.add(new THREE.TorusGeometry(0.08, 0.025, 4, 8), C.brass, { p: [0, 0.36, 0] }); return b.build(); })(), mat); root.add(S.weightM);
    S.chainM = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1, 4), new THREE.MeshBasicMaterial({ color: 0x6d6258, fog: true })); root.add(S.chainM);
    // ---------- bell and automaton ----------
    S.bell = X.bell(1.5); S.bell.group.position.set(0, 16.05, -0.2); root.add(S.bell.group);
    S.hammer = new THREE.Group(); S.hammer.position.set(0.5, 15.9, -0.2); root.add(S.hammer);
    { const b = new P.Builder(270); b.add(new THREE.BoxGeometry(0.05, 0.4, 0.05), C.woodDark, { p: [0, -0.2, 0] }); b.add(new THREE.SphereGeometry(0.07, 6, 4), C.brass, { p: [0, -0.42, 0] }); S.hammer.add(b.mesh(matFine, null)); }
    S.auto = new THREE.Group(); S.auto.position.set(0, 9.42, 1.2); root.add(S.auto);
    { const b = new P.Builder(271); b.add(new THREE.SphereGeometry(0.15, 10, 8), C.coral, { s: [1.2, 1, 1] }); b.add(new THREE.SphereGeometry(0.09, 8, 6), C.coral, { p: [0.12, 0.13, 0] }); b.add(new THREE.ConeGeometry(0.035, 0.12, 5), C.brass, { p: [0.24, 0.13, 0], r: [0, 0, -Math.PI / 2] }); b.add(new THREE.BoxGeometry(0.03, 0.24, 0.03), C.brass, { p: [0, -0.2, 0] });
      S.auto.add(b.mesh(matFine, inkThin)); }
    // ---------- the little world around ----------
    S.keeper = X.caretaker({ coat: 0x7a5a6e, hat: 0xe2c06e }); S.keeper.group.position.set(-2.9, 0, 2.6); S.keeper.group.rotation.y = 0.6; root.add(S.keeper.group);
    const pr = new P.Builder(280);
    // ladder leaning on the tower
    for (const dx of [-0.2, 0.2]) pr.add(new THREE.BoxGeometry(0.06, 4.2, 0.06), C.woodLight, { p: [-3.25 + dx, 2.0, 1.85], r: [0.18, 0, 0] });
    for (let k = 0; k < 9; k++) pr.add(new THREE.BoxGeometry(0.42, 0.04, 0.04), C.woodLight, { p: [-3.25, 0.3 + k * 0.45, 2.2 - k * 0.08] });
    pr.add(new THREE.BoxGeometry(0.7, 0.5, 0.6), C.woodLight, { p: [-3.9, 0.25, 2.3], r: [0, 0.3, 0] });
    pr.add(new THREE.BoxGeometry(0.5, 0.4, 0.5), C.wood, { p: [-3.8, 0.7, 2.25], r: [0, -0.2, 0] });
    // benches, a lamp post, a low wall
    pr.add(new THREE.BoxGeometry(1.3, 0.08, 0.4), C.wood, { p: [4.6, 0.45, 3.2], r: [0, -0.3, 0] });
    for (const dx of [-0.5, 0.5]) pr.add(new THREE.BoxGeometry(0.08, 0.45, 0.35), C.woodDark, { p: [4.6 + dx * 0.95, 0.22, 3.2 - dx * 0.3], r: [0, -0.3, 0] });
    pr.add(new THREE.CylinderGeometry(0.05, 0.07, 2.4, 6), C.slate, { p: [-5.0, 1.2, 3.4] });
    pr.add(new THREE.BoxGeometry(0.28, 0.32, 0.28), C.brass, { p: [-5.0, 2.5, 3.4] });
    for (let k = 0; k < 10; k++) pr.add(new THREE.BoxGeometry(0.9, 0.45, 0.45), k % 3 ? C.stone2 : C.stone, { p: [3.0 + k * 0.85, 0.22, -2.6 + Math.sin(k) * 0.2] }, { jitter: 0.06 });
    // a little house and a fountain
    pr.add(new THREE.BoxGeometry(2.4, 2.0, 2.0), C.cream, { p: [6.6, 1.0, -4.5], r: [0, -0.3, 0] }, { jitter: 0.05 });
    const hr = new THREE.ConeGeometry(2.0, 1.2, 4); hr.rotateY(Math.PI / 4);
    pr.add(hr, C.roof, { p: [6.6, 2.6, -4.5], r: [0, -0.3, 0], s: [1.3, 1, 1] });
    pr.add(new THREE.CylinderGeometry(0.9, 1.0, 0.45, 14), C.stone2, { p: [-4.3, 0.22, 5.0] }, { jitter: 0.03 });
    pr.add(new THREE.CylinderGeometry(0.14, 0.18, 0.9, 8), C.stone, { p: [-4.3, 0.7, 5.0] });
    root.add(pr.mesh(mat, ink));
    S.fountain = new THREE.Mesh(new THREE.CircleGeometry(0.82, 18), waterMaterial(THREE, { scale: 0.6, speed: 0.3 })); S.fountain.rotation.x = -Math.PI / 2; S.fountain.position.set(-4.3, 0.42, 5.0); root.add(S.fountain);
    const fb = new P.Builder(290), tb = new P.Builder(291);
    E.tree(tb, fb, 4.6, 0, -0.8, 1.6, 21); E.tree(tb, fb, -5.4, 0, -1.8, 1.3, 22); E.tree(tb, fb, -9, 0.3, -5, 1.7, 23); E.tree(tb, fb, 9.5, 0.3, 1.2, 1.3, 24); E.tree(tb, fb, -2.6, 0, -4.2, 1.1, 25);
    const bush = (x, z, s, seed) => { const r = makeRng(seed); for (let i = 0; i < 3; i++) fb.add(P.blob(r.range(0.35, 0.55) * s, seed * 3 + i), r.pick([0x8a9a5b, 0x93a663, 0x9fb06a]), { p: [x + r.range(-0.4, 0.4) * s, 0.25 * s, z + r.range(-0.3, 0.3) * s] }, { shade: 0.35, top: 0xd4c87a, topAmt: 0.4 }); };
    bush(2.7, 2.2, 1.1, 31); bush(-2.4, 2.6, 0.9, 32); bush(-6.2, 1.8, 1.2, 33); bush(6.0, 0.6, 1.0, 34);
    S.foliage = new THREE.Mesh(fb.build(), E.foliageMat()); S.foliage.castShadow = true; root.add(S.foliage);
    root.add(tb.mesh(mat, inkThin));
    // a distant windmill, turning on the hill: world I, seen from here
    S.farMill = new THREE.Group(); S.farMill.position.set(-15, 3.2, -58); S.farMill.scale.setScalar(1.3); root.add(S.farMill);
    { const b = new P.Builder(300); b.add(P.tower(1.6, 1.1, 6, 8, 3), 0xcfd2c6, { p: [0, 3, 0] }); b.add(new THREE.ConeGeometry(1.3, 1.6, 8), 0x8ea3b0, { p: [0, 6.7, 0] }); S.farMill.add(new THREE.Mesh(b.build(), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }))); }
    S.farSails = new THREE.Group(); S.farSails.position.set(0, 6.3, 1.3); S.farMill.add(S.farSails);
    for (let k = 0; k < 4; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 4.2), new THREE.MeshBasicMaterial({ color: 0xe6dcb6, fog: true, side: THREE.DoubleSide })); m.geometry.translate(0.3, 2.2, 0); m.rotation.z = k * Math.PI / 2; S.farSails.add(m); }
    root.add(E.grass({ count: 3600, x0: -20, x1: 14, z0: -8, z1: 12, root: 0x93a85e, tip: 0xdcd590, tip2: 0xeedfa4, scale: 0.75, heightAt: S.heightAt, seed: 9,
      accept: (x, z, r) => (z < 6 || r() < 0.45) && pathAt(x, z) < 0.3 && !(Math.abs(x) < 2.8 && z < 3.2 && z > -2) && Math.hypot(x + 4.3, z - 5) > 1.2 }));
    root.add(E.wildflowers({ count: 600, x0: -18, x1: 12, z0: -6, z1: 12, heightAt: S.heightAt, accept: (x, z) => pathAt(x, z) < 0.2 && !(Math.abs(x) < 2.8 && z < 3.2) }));
    root.add(E.layers([
      { kind: 'hills', seed: 17, w: 280, y: 16, z: -120, color: 0xbccbb6 },
      { kind: 'town', seed: 19, w: 220, y: 9, z: -85, color: 0xb1bea7, order: 1 },
      { kind: 'hills', seed: 23, w: 200, y: 5, z: -70, color: 0xa9ba98, order: 2 }
    ]));
    S.clouds = E.clouds({ count: 11, y0: 16, y1: 70, seed: 9 }); root.add(S.clouds);
    S.birds = E.birds(root, [[-1.6, 13.52, 1.1], [-0.9, 13.5, 1.6], [1.2, 9.2, 1.9], [2.0, 9.2, 1.75], [3.25, 12.9, 0.9]], 0x4b4f5c);
    S.ribbons = E.ribbons(root); S.leaves = E.leaves(root, 60);
    S.gustCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(-20, 1.5, 7), new THREE.Vector3(-11, 2.0, 5), new THREE.Vector3(-4.5, 2.4, 3.2), new THREE.Vector3(-0.4, 2.6, 1.0), new THREE.Vector3(4, 3.4, -1.5)]);
    S.lamp = new THREE.Sprite(new THREE.SpriteMaterial({ map: P.dotTex, color: 0xffd27a, transparent: true, opacity: 0, depthWrite: false })); S.lamp.position.set(-5.0, 2.55, 3.45); S.lamp.scale.set(1.4, 1.4, 1); root.add(S.lamp);
  };

  // ---------- simulation ----------
  let st = null;
  const MAXA = 0.27; // radians at full amplitude
  W.begin = (L, G) => {
    S.ribbons.clear(); S.leaves.clear();
    st = { L, A: L.startA, phase: 0, period: 2 * G.beat, minutes: L.start || 0, startMin: L.start || 0, weight: L.weight || 0, wheelSteps: 0, wheelA: 0, wheelTarget: 0,
      chimes: 0, hours: 0, waiting: false, autoT: -9, bang: 0, pushes: 0, gusts: [], nextGust: 6 + G.rng() * 4, lastPushT: 0, finale: false, latches: 0, lastTick: 0, ticks: 0, hammerT: -9, nextOps: [], dripT: 0 };
    // start the swing so its extremes land on the pulse
    st.phase = Math.PI / 2 - ((G.t0 - G.t) / st.period) * TAU;
    S.keeper.sit = 0;
    if (S.weightM) S.weightM.position.y = weightY();
  };
  const weightY = () => 1.4 + st.weight * 1.0;
  // the time (after `from`) of the next extreme of the swing
  function nextExtreme(from, G) {
    const w = TAU / st.period; let ph = st.phase + (from - G.t) * w;
    const k = Math.ceil((ph - Math.PI / 2) / Math.PI - 1e-6);
    const target = Math.PI / 2 + k * Math.PI;
    return { t: from + (target - ph) / w, side: (k % 2 === 0) ? 1 : -1 };
  }
  // keep ops for the next two extremes (optional pushes) and the wheel's pointer
  function schedule(G) {
    const L = st.L;
    // drop future pushes if the swing changed under them
    for (const op of st.nextOps) if (!op.done && op.stale) op.done = true;
    st.nextOps = st.nextOps.filter(o => !o.done);
    const have = st.nextOps.filter(o => o.kind === 'push').length;
    if (st.A > 0.03 && have < 2) {
      let from = G.t; const last = st.nextOps.filter(o => o.kind === 'push').pop(); if (last) from = last.t + 0.05;
      for (let i = have; i < 2; i++) { const e = nextExtreme(from, G); const op = G.addOp('push', e.t, { side: e.side }); op.optional = true; st.nextOps.push(op); from = e.t + 0.05; }
    }
  }
  function swingShift(G, dphi) {
    st.phase += dphi;
    for (const op of st.nextOps) if (!op.done && op.kind === 'push') op.done = true;
    st.nextOps = st.nextOps.filter(o => o.kind !== 'push');
  }

  W.resolve = (op, res, d, G) => {
    const t = G.t;
    if (op.kind === 'push') {
      const pu = S.pushers[op.data.side > 0 ? 1 : 0]; pu.t = t;
      const gain = { flow: 0.17, good: 0.1, early: -0.06, late: 0.03 }[res] || 0;
      st.A = Math.max(0, st.A + gain); st.lastPushT = t; st.pushes++;
      if (res === 'flow' || res === 'good') { audio.knock(t, 1.6, 0.6); audio.catchFlow(t, res === 'flow' ? 0.8 : 0.5); }
      else if (res === 'early') { audio.knock(t, 0.7, 0.9); }
      else audio.knock(t, 1.0, 0.5);
      if (st.A > 1.06) { st.A = 0.82; st.bang = 1; audio.knock(t + 0.03, 0.5, 1.2); audio.ratchet(t + 0.05, 1); G.event('overswing'); S.birds.startle(S.pend.position, 4); }
    } else if (op.kind === 'latch') {
      if (res === 'flow' || res === 'good') { st.weight = Math.min(6, st.weight + 1); st.latches++; audio.latch(t, res === 'flow' ? 1 : 0.7, st.weight * 2); S.pawl.rotation.z = -0.6; G.focus(S.pawl.position, 0.2); }
      else { if (st.weight > 0) st.weight -= 1; audio.ratchet(t); audio.ratchet(t + 0.07); audio.knock(t + 0.1, 0.8, 0.8); S.pawl.rotation.z = 0.5; }
    }
  };
  W.passed = (op, G) => {
    if (op.kind === 'latch' && st.weight > 0 && st.L.wheel) { st.weight -= 1; audio.ratchet(G.t); }
  };
  W.idle = (G) => { const side = Math.sin(st.phase) > 0 ? 1 : 0; S.pushers[side].t = G.t; audio.knock(G.t, 1.2, 0.4); st.A = Math.max(0, st.A - 0.02); };
  W.objective = (G) => {
    const g = st.L.goal;
    if (g.type === 'amp') return { ticks: Math.min(5, Math.floor(st.A / 0.85 * 5 + 0.001)), need: 5, done: st.A >= 0.85 };
    if (g.type === 'minutes') { const m = st.minutes - st.startMin; return { ticks: Math.min(5, Math.floor(m / 2)), need: 5, done: m >= g.need }; }
    if (g.type === 'weight') return { ticks: st.weight, need: g.need, done: st.weight >= g.need };
    if (g.type === 'chimes') return { ticks: st.chimes, need: g.need, done: st.chimes >= g.need };
    return { ticks: st.chimes, need: 0, done: false, timed: true };
  };
  W.stats = () => ({ hours: st.chimes, weight: st.weight, minutes: Math.round(st.minutes - st.startMin) });
  W._st = () => st;
  W.hint = () => null;
  W.botWants = op => op.kind !== 'push' || st.A < (st.L.goal.type === 'amp' ? 0.88 : 0.7);
  W.discovery = L => ({ 1: 'the pendulum', 3: 'the great wheel', 4: 'the hour bell', 5: 'wind in the arch' })[L.n] || null;

  const _p = new THREE.Vector3(), _q = new THREE.Vector3();
  W.update = (dt, G) => {
    const t = G.t, L = st.L, flow = G.flow;
    U.t.value = t; E.windU.uTime.value = t; E.windU.uBase.value = 0.1 + flow * 0.1;
    // the swing: a fixed period, an amplitude that slowly fades
    st.A = Math.max(0, st.A - (0.03 + 0.05 * st.A) * dt * (st.finale ? 0 : 1));
    if (st.finale) st.A = damp(st.A, 0.85, 1, dt);
    const prevPh = st.phase;
    st.phase += (TAU / st.period) * dt;
    // in flow, the swing quietly settles back onto the shared pulse
    if (flow > 0.4 && st.A > 0.3) { const want = Math.PI / 2 + ((t - G.t0) / st.period) * TAU; let e = (st.phase - want) % Math.PI; if (e > Math.PI / 2) e -= Math.PI; if (e < -Math.PI / 2) e += Math.PI; st.phase -= e * 0.4 * dt; }
    st.bang = damp(st.bang, 0, 4, dt);
    const ang = Math.sin(st.phase) * st.A * MAXA;
    S.pend.rotation.z = ang + Math.sin(t * 40) * st.bang * 0.03;
    S.stops.forEach((s, i) => { s.position.x = (i ? 1 : -1) * (1.1 - st.bang * 0.04); });
    for (const pu of S.pushers) { const k = clamp(1 - (t - pu.t) / 0.35); pu.g.rotation.z = -pu.sx * Math.sin(k * Math.PI) * 0.5; }
    // each extreme of a live swing is a tick of the escapement
    const crossed = Math.floor((st.phase - Math.PI / 2) / Math.PI) !== Math.floor((prevPh - Math.PI / 2) / Math.PI);
    const running = L.escape && st.A > 0.3;
    if (crossed && st.A > 0.05) {
      if (running) {
        st.ticks++; audio.tick(t, st.ticks % 2 === 0);
        st.minutes += 0.5; st.lastTick = t;
        if (L.wheel) stepWheel(G);
        if (L.chimes && Math.floor(st.minutes) % 15 === 0 && Math.floor(st.minutes) !== st.lastQuarter && st.minutes % 1 === 0) { st.lastQuarter = Math.floor(st.minutes); st.waiting = true; }
      } else if (st.A > 0.12) audio.tick(t, true);
    }
    // a waiting hammer falls the moment the weight allows it
    if (st.waiting) {
      const cost = Math.round(st.minutes) % 60 === 0 ? 3 : 2;
      S.hammer.rotation.z = damp(S.hammer.rotation.z, -0.9 + Math.sin(t * 20) * 0.04, 6, dt);
      if (st.weight >= cost) { st.weight -= cost; st.waiting = false; chime(G, cost === 3); }
    } else S.hammer.rotation.z = damp(S.hammer.rotation.z, 0, 8, dt);
    // the hands
    const m = st.minutes;
    S.minHand.rotation.z = damp(S.minHand.rotation.z, -(m / 60) * TAU, 18, dt);
    S.hourHand.rotation.z = -(m / 720) * TAU;
    for (const g of S.gears) g.m.rotation.z = damp(g.m.rotation.z, (g.back ? -1 : 1) * st.ticks * (0.5 / g.r) * 0.3, 14, dt);
    // great wheel steps toward its target; the pointer's arrival is an op
    S.wheel.rotation.z = damp(S.wheel.rotation.z, -st.wheelA, 10, dt);
    S.pawl.rotation.z = damp(S.pawl.rotation.z, st.pointerNear ? 0.25 + Math.sin(t * 22) * 0.04 : 0, 8, dt);
    // weight and chain
    S.weightM.position.set(-2.95, damp(S.weightM.position.y || weightY(), weightY(), 5, dt), 1.3);
    const cy = S.weightM.position.y + 0.3, top = 8.55;
    S.chainM.position.set(-2.95, (cy + top) / 2, 1.3); S.chainM.scale.y = Math.max(0.05, top - cy);
    S.wPulley.rotation.z = -S.weightM.position.y * 2;
    // the automaton bird
    const at = t - st.autoT;
    const out = at < 3.2 ? smooth(at / 0.5) * (1 - smooth((at - 2.6) / 0.6)) : 0;
    S.auto.position.z = 1.2 + out * 0.55; S.auto.rotation.y = Math.sin(at * 6) * 0.3 * out; S.auto.visible = out > 0.02;
    // gusts through the arch (they push the swing off its pulse)
    if (L.gusts && G.playing && !st.finale) {
      if (t > st.nextGust) { spawnGust(G); st.nextGust = t + lerp(9, 5, L.gusts) + G.rng() * 5; }
    }
    const gU = E.windU.uG.value; let gi = 0, near = 0;
    for (let i = st.gusts.length - 1; i >= 0; i--) {
      const g = st.gusts[i], s = (t - g.t0) / (g.tA - g.t0);
      if (s > 1.7) { S.ribbons.release(g); st.gusts.splice(i, 1); continue; }
      const fade = (s < 0.15 ? s / 0.15 : 1) * clamp(1 - (s - 1.2) * 2);
      S.ribbons.draw(g, s, fade, t);
      g.curve.getPointAt(clamp(s), _p);
      if (gi < 4) { gU[gi].set(_p.x, 0.9 * fade, 1, 3); gi++; }
      if (s < 1 && Math.random() < dt * 14) S.leaves.emit(_p, _q.set(5, 0.4, -0.6), 1, 1.2);
      if (s < 1) near = Math.max(near, smooth((s - 0.5) / 0.5));
      if (!g.hit && s >= 0.78) { g.hit = true; const shove = G.rng.range(0.5, 1.1) * G.rng.sign(); swingShift(G, shove); st.A = Math.min(1, st.A + 0.05); audio.whooshPast(t); S.birds.startle(S.pend.position, 3); }
    }
    for (; gi < 4; gi++) gU[gi].set(0, 0, 1, 1);
    S.leaves.update(dt, near > 0 ? 5 : 0.3);
    schedule(G);
    if (L.wheel) scheduleLatch(G);
    // keeper watches the swing; sits if it stops
    const K = S.keeper; K.look = damp(K.look, -0.4 + ang * 0.8, 4, dt);
    if (st.A < 0.08 && G.playing && t - st.lastPushT > 10) K.sit = damp(K.sit, 1, 2, dt); else K.sit = damp(K.sit, 0, 4, dt);
    K.cheer = damp(K.cheer, st.finale ? 0.5 + 0.5 * Math.sin(t * 6) : 0, 4, dt); K.update(dt);
    // drip from the pipe, ticking on its own little time
    st.dripT += dt; const dp = st.dripT / 1.7; S.drip.position.set(S.dripSpot.x, S.dripSpot.y - Math.pow(dp % 1, 2) * 6.4, S.dripSpot.z); S.drip.visible = (dp % 1) < 0.95;
    if (Math.floor(dp) !== Math.floor((st.dripT - dt) / 1.7)) audio.drip(t, 3 + (Math.floor(dp) % 3));
    S.fountain.material.uniforms.uT.value = t;
    S.farSails.rotation.z += dt * (0.4 + flow * 1.2);
    S.lamp.material.opacity = damp(S.lamp.material.opacity, flow > 0.6 || st.finale ? 0.7 : 0, 2, dt);
    S.archGlow.material.opacity = 0.4 + st.A * 0.3 + Math.sin(t * 2.3) * 0.03;
    S.bell.update(dt); S.birds.update(dt, t);
    S.clouds.userData.update(dt, flow * 0.3);
  };
  function stepWheel(G) {
    const per = st.L.wheelBeats || 6;
    st.wheelSteps++; st.wheelA = (st.wheelSteps / per) * TAU;
    audio.ratchet(G.t, 0.5);
  }
  // when the pointer is one step from the top, the next tick brings it there
  function scheduleLatch(G) {
    const per = st.L.wheelBeats || 6;
    const stepsToTop = (per - (st.wheelSteps % per)) % per;
    st.pointerNear = stepsToTop === 1 && st.A > 0.3;
    if (stepsToTop === 1 && st.A > 0.3 && (!st.latchOp || st.latchOp.done) && st.latchFor !== st.wheelSteps) {
      const e = nextExtreme(G.t + 0.02, G);
      st.latchOp = G.addOp('latch', e.t, {}); st.latchFor = st.wheelSteps;
    }
    // if the swing died before the pointer arrived, the moment is gone
    if (st.latchOp && !st.latchOp.done && st.A <= 0.3) { st.latchOp.done = true; }
  }
  function spawnGust(G) {
    const lead = 2.6 * G.beat;
    const g = { t0: G.t, tA: G.t + lead, curve: S.gustCurve };
    S.ribbons.spawn(g, 4, 0xf3c45a); audio.gust(g.tA, lead, 1, false);
    st.gusts.push(g);
  }
  function chime(G, hour) {
    const t = G.t;
    st.chimes++; st.autoT = t;
    S.bell.ring(hour ? 1.6 : 1.1); S.hammer.rotation.z = 0.5;
    for (let k = 0; k < (hour ? 3 : 2); k++) audio.bell(t + k * G.beat, [0, 4, 2][k] + 3, hour ? 1.2 : 0.9);
    audio.chirp(t + 0.6, 4); audio.setChord(st.chimes % 4); if (hour) audio.swell(t, 3);
    S.birds.startle(S.bell.group.position, 30);
    G.event('hour');
    G.focus(S.bell.group.position, 0.3);
  }
  W.audioState = () => ({ wind: 0.18 + (st.gusts.length ? 0.4 : 0), water: 0.15, hum: 0, humPitch: 0, bloom: clamp(st.chimes / 3) });
  W.finale = (G) => { st.finale = true; S.bell.ring(1.5); audio.bell(G.t + 0.2, 7, 1); audio.swell(G.t, 3); st.autoT = G.t; S.birds.startle(S.bell.group.position, 40); };
  W.points = () => ({ hub: S.pend.position });
  return W;
}
