// =====================================================================
// THE LAST SIGNAL — the vertical slice. An old tiled city consumed by
// industry, from a small terrace to the signal relay, with the great relay
// tower always on the horizon. Along the way runs the broken signal line:
// dead waypoint relays that wake as the core passes them.
//
//   ACT 1  ROOFS     A terrace -> B tiled roof (up and over) -> alley jump
//                    -> C ridge run (slopes, chimney, broken section)
//   ACT 2  JUNCTION  the great pipe into a junction tank, then a choice:
//      high road  thin pipe climbing to a scaffold, a swaying rope bridge,
//                 a leap and a drop. Balance and height. Three fragments.
//      centre     the wide pipe through two steam vents. Timing.
//      low road   down to a sunken catwalk, squeeze under a duct, hop a pipe,
//                 climb a ramp. Safe and slower. No fragments.
//                 All three merge on the machine platform (waypoint).
//   ACT 3  CATWALK   a narrow suspended walkway: a broken gap, a squeeze, a
//                    section that gives way if you stall, a fragment overhead
//   ACT 4  RELAY     lean-to tin roof -> 3 m drop -> the relay terrace
//
// Pure data: shapes with a `kind` the renderer turns into architecture,
// hazards, fragments, waypoints, checkpoints. Nothing here knows three.js.
// =====================================================================

const STREET_Y = -16;

function buildSlice(world) {
  const decor = [], vents = [], fragments = [], unstable = [], bridges = [], waypoints = [];
  const add = b => world.add(b);
  const walls = (x0, x1, top, zFar, zNear, tags) => add(boxSpan(x0, x1, STREET_Y, top, zFar, zNear, Object.assign({ kind: 'building' }, tags)));

  // ================= ACT 1: ROOFS =================
  // ---- A: the terrace ----
  walls(-1.7, 1.7, 0, -5, 3, { walk: true, kind: 'terrace' });
  add(boxSpan(-1.7, -1.45, 0, 0.42, -5, 3, { kind: 'parapet', walk: true }));
  add(boxSpan(1.45, 1.7, 0, 0.42, -5, 3, { kind: 'parapet', walk: true }));
  add(boxSpan(-1.45, 1.45, 0, 0.42, 2.75, 3, { kind: 'parapet', walk: true }));
  decor.push({ kind: 'pots', x: -1.15, y: 0, z: 0.5 }, { kind: 'pots', x: 1.2, y: 0, z: -2.5 });
  decor.push({ kind: 'lamp', x: 1.4, y: 1.6, z: -4.6, color: 'warm' });
  decor.push({ kind: 'bowl', x: -1.0, y: 0, z: -1.2 });             // someone still feeds the strays here

  // ---- B: tiled roof, ridge across the route ----
  walls(-2.4, 2.4, -0.3, -13, -5, { plaster: 1 });
  add(gableX(-2.65, 2.65, -0.3, 0, 1.3, -13.25, -4.85, { kind: 'roof' }));
  add(boxSpan(-1.6, -0.9, 0.6, 2.2, -9.4, -8.6, { kind: 'chimney' }));
  add(boxSpan(1.15, 1.75, 0.5, 2.0, -9.3, -8.7, { kind: 'chimney' }));
  decor.push({ kind: 'antenna', x: 2.1, y: 0.55, z: -10.5 });

  // ---- C: long roof, ridge along the route; a broken section near its end ----
  walls(-2.2, 2.6, -1.0, -26.0, -14.6, { plaster: 2 });
  walls(-2.2, 2.6, -1.0, -30.2, -27.8, { plaster: 2 });
  add(gableZ(-2.25, 2.65, -1.0, -0.62, 0.5, -26.0, -14.6, { kind: 'roof' }));
  add(gableZ(-2.25, 2.65, -1.0, -0.62, 0.5, -30.2, -27.8, { kind: 'roof' }));
  decor.push({ kind: 'brokenRoof', x0: -2.25, x1: 2.65, z0: -27.8, z1: -26.0, y: 0.5, eave: -0.62 });
  add(boxSpan(-0.15, 0.55, 0.2, 1.45, -20.4, -19.6, { kind: 'chimney' }));
  add(boxSpan(1.5, 2.0, -0.3, 0.9, -23.6, -23.0, { kind: 'chimney' }));
  decor.push({ kind: 'lamp', x: -2.3, y: 0.2, z: -17, color: 'warm' });
  fragments.push({ x: -0.75, y: 0.35, z: -22.4 });                 // where the line snapped over the slope
  waypoints.push({ x: 2.3, y: -0.45, z: -29 });                    // first dead relay, on the far eave

  // ================= ACT 2: THE JUNCTION =================
  add(pipeZ(0.2, -0.05, 0.55, -33.2, -29.6, { kind: 'pipe' }));
  add(boxSpan(-1.6, 2.2, -2.5, 0.5, -36.6, -33.2, { kind: 'tank', walk: true, surface: 'metal' }));
  decor.push({ kind: 'lamp', x: -1.5, y: 1.3, z: -36.8, color: 'green' });     // the high road
  decor.push({ kind: 'lamp', x: 2.25, y: 0.1, z: -36.8, color: 'violet' });    // the low road
  decor.push({ kind: 'gauge', x: 0.2, y: 0.5, z: -33.6 });

  // high road: a thin pipe climbing to a scaffold, then a rope bridge, then a drop
  add(pipeZ(-1.1, 0.3, 0.2, -44.6, -36.6, { kind: 'pipe', narrow: true, cyFar: 1.5 }));
  fragments.push({ x: -1.1, y: 1.3, z: -40.6 });
  add(boxSpan(-2.2, -0.3, 1.55, 1.7, -46.6, -44.6, { kind: 'scaffold', walk: true, surface: 'wood' }));
  bridges.push(add(boxSpan(-1.5, -1.0, 1.62, 1.7, -53, -46.6, { kind: 'bridge', walk: true, surface: 'wood', cam: 'none' })));
  fragments.push({ x: -1.25, y: 1.95, z: -50 });
  add(boxSpan(-2.2, -0.4, 1.5, 1.7, -55, -53, { kind: 'scaffold', walk: true, surface: 'wood' }));
  fragments.push({ x: -1.25, y: 2.45, z: -54.3 });                 // leap from the scaffold's edge for it

  // centre: the wide pipe and two vents. Nothing to collect: a test of timing
  const big = add(pipeZ(0.2, -0.05, 0.55, -55, -36.6, { kind: 'pipe' }));
  vents.push({ x: 0.2, y: big.cy + big.r, z: -40, phase: 0 });
  vents.push({ x: 0.2, y: big.cy + big.r, z: -45.4, phase: 1.1 });

  // low road: a sunken catwalk, a squeeze under a duct, a pipe to hop, a ramp back up
  add(boxSpan(1.5, 2.3, -1.08, -1.0, -50.5, -36.6, { kind: 'catwalk', walk: true, surface: 'metal', cam: 'none' }));
  add(boxSpan(1.2, 2.6, -0.7, -0.3, -42, -40.6, { kind: 'duct', cam: 'fade', walk: true }));
  add(boxSpan(1.3, 2.5, -1.0, -0.62, -45.6, -45, { kind: 'hopPipe', walk: true, cam: 'none' }));
  add(shed(1.4, 2.4, -1.6, -1.0, 0.1, -55, -50.5, { kind: 'ramp', surface: 'metal' }));
  decor.push({ kind: 'lamp', x: 2.5, y: -0.2, z: -47, color: 'warm' });

  // the machine platform: the three routes meet
  add(boxSpan(-2.2, 2.6, -0.4, 0.1, -61, -55, { kind: 'grate', walk: true, surface: 'metal' }));
  add(boxSpan(-2.2, -1.4, 0.1, 1.1, -60.5, -58.6, { kind: 'machine' }));
  waypoints.push({ x: 2.2, y: 0.1, z: -59.5 });

  // ================= ACT 3: THE CATWALK =================
  const cw = (zf, zn, extra) => add(boxSpan(-0.4, 0.1, 0.02, 0.1, zf, zn, Object.assign({ kind: 'catwalk', walk: true, surface: 'metal', cam: 'none' }, extra)));
  cw(-64.5, -61);
  // broken gap (1.9 m)
  cw(-69.4, -66.4);
  add(boxSpan(-1.4, 1.2, 0.4, 0.66, -68.2, -67.4, { kind: 'lowPipe', cam: 'fade', walk: true }));
  unstable.push(cw(-72, -69.4, { unstable: true }));
  cw(-78, -72);
  fragments.push({ x: -0.15, y: 1.05, z: -75 });
  decor.push({ kind: 'brokenCatwalk', x0: -0.4, x1: 0.1, z0: -66.4, z1: -64.5, y: 0.1 });
  decor.push({ kind: 'lamp', x: 0.4, y: 1.3, z: -73, color: 'green' });

  // ================= ACT 4: THE RELAY =================
  walls(-1.6, 1.6, -0.9, -84, -78, { plaster: 3 });
  add(shed(-1.65, 1.65, -0.9, 0.1, -0.35, -84, -78, { kind: 'tinRoof' }));
  waypoints.push({ x: 1.35, y: -0.2, z: -82.5 });
  const hY = -1.6;
  walls(-3, 3, hY, -101, -87, { walk: true, kind: 'terrace', plaster: 4 });
  add(boxSpan(-3, -2.75, hY, hY + 0.45, -101, -87, { kind: 'parapet', walk: true }));
  add(boxSpan(2.75, 3, hY, hY + 0.45, -101, -87, { kind: 'parapet', walk: true }));
  add(boxSpan(-2.75, 2.75, hY, hY + 0.45, -101, -100.75, { kind: 'parapet', walk: true }));
  const relay = { x: 0, y: hY, z: -96 };
  decor.push({ kind: 'lamp', x: -2.6, y: hY + 1.6, z: -90, color: 'warm' });

  // the dead signal line: sagging from relay to relay, snapped where fragments fell
  decor.push({ kind: 'signalLine', points: [[-3.5, 3.2, 4], ...waypoints.map(w => [w.x, w.y + 2.9, w.z]), [relay.x, relay.y + 3.15, relay.z]] });
  for (const f of fragments) decor.push({ kind: 'snapped', x: f.x + 0.35, y: f.y + 1.2, z: f.z + 0.4 });

  scenery(world, decor);

  return {
    decor, vents, fragments, unstable, bridges, waypoints, relay,
    tower: { x: 26, z: -255, base: STREET_Y, height: 74 },
    spawn: [0, 0, 1.5],
    endZ: -100,
    checkpoints: [[0, 0, 1.5], [0.2, 0.5, -15.6], [0.2, 0.5, -31], [-1.3, 1.7, -45.6], [1.9, -1.0, -38], [0, 0.1, -57], [-0.15, 0.1, -63], [-0.15, 0.1, -74], [0, 0.1, -78.6], [0, hY, -88.5]]
  };
}

// The neighbourhood: blocks close on both sides of the route at very
// different heights, extensions stacked on top and leaning over the
// alleys, occasional towers, cables and bridges strung overhead, and far
// layers climbing toward the tower. Seeded, so the city is the same every
// visit. All of it is out of reach: landing there counts as a fall.
function scenery(world, decor) {
  const rng = makeRng(1702);
  const corridor = z => z > -5 ? 1.9 : z > -30 ? 3 : z > -55 ? 3.2 : z > -78 ? 2.6 : z > -87 ? 2 : 3.3;
  for (const side of [-1, 1]) {
    let z = 6;
    while (z > -115) {
      const len = 3.5 + rng() * 5.5, zf = z - len;
      const inner = Math.max(corridor(z), corridor(zf), corridor((z + zf) / 2)) + 0.5 + rng() * 1.3;
      const w = 3.5 + rng() * 5;
      const x0 = side < 0 ? -inner - w : inner, x1 = side < 0 ? -inner : inner + w;
      const tower = rng() < 0.14;
      const top = tower ? 6 + rng() * 6 : -5 + rng() * 9;
      world.add(boxSpan(x0, x1, STREET_Y, top, zf, z, { kind: 'building', far: true, plaster: (rng() * 5) | 0 }));
      // an extension stacked on top, offset toward the route
      let rt = top, rx0 = x0, rx1 = x1, rz0 = zf, rz1 = z;
      if (!tower && rng() < 0.55) {
        const ew = w * (0.4 + rng() * 0.35), eh = 1.8 + rng() * 1.6;
        rx0 = side < 0 ? x1 - ew : x0; rx1 = side < 0 ? x1 : x0 + ew;
        rz1 = z - rng() * len * 0.3; rz0 = rz1 - len * (0.4 + rng() * 0.4);
        world.add(boxSpan(rx0, rx1, top, top + eh, rz0, rz1, { kind: 'building', far: true, plaster: (rng() * 5) | 0 }));
        rt = top + eh;
        if (rng() < 0.5) rng();
      }
      const roof = rng();
      if (roof < 0.45) world.add(gableZ(rx0 - 0.15, rx1 + 0.15, rt, rt + 0.3, rt + 0.3 + (rx1 - rx0) * 0.32, rz0 - 0.15, rz1 + 0.15, { kind: 'roof', far: true }));
      else if (roof < 0.75) world.add(gableX(rx0 - 0.15, rx1 + 0.15, rt, rt + 0.3, rt + 0.3 + (rz1 - rz0) * 0.3, rz0 - 0.15, rz1 + 0.15, { kind: 'roof', far: true }));
      else decor.push({ kind: 'tank', x: (rx0 + rx1) / 2, y: rt, z: (rz0 + rz1) / 2, r: 0.7, h: 1.3 });
      if (rng() < 0.45) decor.push({ kind: 'stack', x: lerp(x0, x1, 0.2 + rng() * 0.6), y: rt, z: lerp(zf, z, 0.3 + rng() * 0.4), h: 1.5 + rng() * 2.5 });
      // scaffolding and boxed-in balconies on the faces that look onto the route
      if (rng() < 0.4 && top > -2) decor.push({ kind: 'scaffoldFace', x: side < 0 ? x1 + 0.35 : x0 - 0.35, y0: Math.max(STREET_Y, top - 7), y1: top + 0.6, z0: zf + 0.3, z1: z - 0.3 });
      if (rng() < 0.6) decor.push({ kind: 'balcony', x: side < 0 ? x1 : x0, y: top - 2 - rng() * 3, z: lerp(zf, z, 0.5), side: -side });
      z = zf - (rng() < 0.35 ? 1.0 + rng() * 1.5 : 0.1);
    }
  }
  // cables and bridges strung across the route, well above the cat and the camera
  for (let z = 2; z > -112; z -= 2.5 + rng() * 3) {
    const n = 1 + (rng() * 3 | 0);
    for (let i = 0; i < n; i++) decor.push({ kind: 'cable', a: [-4.5 - rng() * 2, 3.4 + rng() * 2.5, z + (rng() - 0.5) * 2], b: [4.5 + rng() * 2, 3.4 + rng() * 2.5, z + (rng() - 0.5) * 2], sag: 0.4 + rng() * 0.6 });
  }
  for (const [z, y] of [[-18, 5.2], [-48, 6.4], [-88, 5.6]]) decor.push({ kind: 'skyBridge', x0: -5, x1: 5, y, z });
  for (const [z, y, r] of [[-11.5, 5.4, 0.45], [-34, 6.2, 0.7], [-66, 4.8, 0.38], [-94, 5.8, 0.55]]) decor.push({ kind: 'crossPipe', x0: -12, x1: 12, y, z, r });
  // far rings: rooflines climbing toward the tower
  for (let ring = 0; ring < 3; ring++) {
    for (let z = 10; z > -245; z -= 7 + ring * 3) {
      for (const side of [-1, 1]) {
        if (rng() < 0.15) continue;
        const x = side * (16 + ring * 14 + rng() * 10), w = 6 + rng() * 6, d = 5 + rng() * 4;
        const top = -4 + ring * 3 + rng() * 6 + Math.max(0, -z - 80) * 0.03;
        decor.push({ kind: 'farBlock', x, z, w, d, top, roof: rng() < 0.6 ? (rng() < 0.5 ? 'z' : 'x') : null, stack: rng() < 0.25 });
      }
    }
  }
}
