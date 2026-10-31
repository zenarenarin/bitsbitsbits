// =====================================================================
// THE LAST SIGNAL — the vertical slice. One authored stretch of an old
// tiled city overgrown by industry, from a small terrace to a signal relay,
// with the great relay tower always on the horizon.
//
//   A  terrace (start)
//   B  tiled roof, ridge across the route: up and over, chimneys on the ridge
//   alley (1.4 m) -> C  long roof, ridge along the route: run the ridge,
//      slopes pull toward the eaves, a chimney to go around, a broken
//      section to jump
//   D  the great pipe (steam vents) | junction | the narrow pipe (no steam,
//      harder line, a fragment)
//   E  junction platform -> F suspended catwalk: squeeze under a low pipe,
//      an unstable section that gives way if you stall
//   G  lean-to tin roof (downhill) -> gap (3 m, 1.5 m drop) -> H relay terrace
//
// Pure data: shapes with a `kind` the renderer turns into architecture,
// hazards, fragments, checkpoints. Nothing here knows about three.js.
// =====================================================================

const STREET_Y = -16;

function buildSlice(world) {
  const decor = [], vents = [], fragments = [], unstable = [];
  const add = b => world.add(b);
  const walls = (x0, x1, top, zFar, zNear, tags) => add(boxSpan(x0, x1, STREET_Y, top, zFar, zNear, Object.assign({ kind: 'building' }, tags)));

  // ---- A: the terrace ----
  walls(-1.7, 1.7, 0, -5, 3, { walk: true, kind: 'terrace' });
  add(boxSpan(-1.7, -1.45, 0, 0.42, -5, 3, { kind: 'parapet', walk: true }));
  add(boxSpan(1.45, 1.7, 0, 0.42, -5, 3, { kind: 'parapet', walk: true }));
  add(boxSpan(-1.45, 1.45, 0, 0.42, 2.75, 3, { kind: 'parapet', walk: true }));
  decor.push({ kind: 'pots', x: -1.15, y: 0, z: 0.5 }, { kind: 'pots', x: 1.2, y: 0, z: -2.5 });
  decor.push({ kind: 'lamp', x: 1.4, y: 1.6, z: -4.6, color: 'warm' });

  // ---- B: tiled roof, ridge across the route ----
  walls(-2.4, 2.4, -0.3, -13, -5, { plaster: 1 });
  add(gableX(-2.65, 2.65, -0.3, 0, 1.3, -13.25, -4.85, { kind: 'roof' }));
  add(boxSpan(-1.6, -0.9, 0.6, 2.2, -9.4, -8.6, { kind: 'chimney' }));
  add(boxSpan(1.15, 1.75, 0.5, 2.0, -9.3, -8.7, { kind: 'chimney' }));
  decor.push({ kind: 'antenna', x: 2.1, y: 0.55, z: -10.5 });

  // ---- alley (1.4 m) ----
  // ---- C: long roof, ridge along the route; a broken section near its end ----
  walls(-2.2, 2.6, -1.0, -26.0, -14.6, { plaster: 2 });
  walls(-2.2, 2.6, -1.0, -30.2, -27.8, { plaster: 2 });
  add(gableZ(-2.25, 2.65, -1.0, -0.62, 0.5, -26.0, -14.6, { kind: 'roof' }));
  add(gableZ(-2.25, 2.65, -1.0, -0.62, 0.5, -30.2, -27.8, { kind: 'roof' }));
  decor.push({ kind: 'brokenRoof', x0: -2.25, x1: 2.65, z0: -27.8, z1: -26.0, y: 0.5, eave: -0.62 });
  add(boxSpan(-0.15, 0.55, 0.2, 1.45, -20.4, -19.6, { kind: 'chimney' }));
  add(boxSpan(1.5, 2.0, -0.3, 0.9, -23.6, -23.0, { kind: 'chimney' }));
  decor.push({ kind: 'lamp', x: -2.3, y: 0.2, z: -17, color: 'warm' });
  fragments.push({ x: -0.75, y: 0.35, z: -22.4 });     // low on the left slope, past the chimney

  // ---- D: the great pipe, and the narrow pipe beside it ----
  const big = add(pipeZ(0.2, -0.05, 0.55, -46, -29.6, { kind: 'pipe' }));
  vents.push({ x: 0.2, y: big.cy + big.r, z: -36.2, phase: 0 });
  vents.push({ x: 0.2, y: big.cy + big.r, z: -41.6, phase: 1.1 });
  add(boxSpan(-1.45, 0.45, -0.5, 0.1, -35.2, -32.5, { kind: 'valve', walk: true, surface: 'metal' }));
  add(pipeZ(-1.2, -0.1, 0.2, -46, -32.5, { kind: 'pipe', narrow: true }));
  fragments.push({ x: -1.2, y: 0.45, z: -40.2 });      // the narrow line's reward
  decor.push({ kind: 'lamp', x: -2.6, y: 1.4, z: -38.5, color: 'green' });
  decor.push({ kind: 'lamp', x: 2.4, y: 1.8, z: -43, color: 'violet' });

  // ---- E: junction platform ----
  add(boxSpan(-1.8, 1.0, -0.4, 0.1, -48.2, -46, { kind: 'grate', walk: true, surface: 'metal' }));

  // ---- F: suspended catwalk ----
  const cw = (zf, zn, extra) => add(boxSpan(-0.55, 0.25, 0.02, 0.1, zf, zn, Object.assign({ kind: 'catwalk', walk: true, surface: 'metal', cam: 'none' }, extra)));
  cw(-54, -48.2);
  unstable.push(cw(-56.5, -54, { unstable: true }));
  cw(-62, -56.5);
  add(boxSpan(0.25, 0.3, 0.1, 0.55, -62, -48.2, { kind: 'rail', cam: 'none' }));
  add(boxSpan(-1.4, 1.2, 0.4, 0.66, -51.9, -51.1, { kind: 'lowPipe', cam: 'fade', walk: true }));
  fragments.push({ x: -0.15, y: 1.05, z: -59.6 });      // above the walkway: jump for it
  decor.push({ kind: 'lamp', x: 0.4, y: 1.3, z: -57.5, color: 'green' });

  // ---- G: lean-to tin roof, downhill ----
  walls(-1.6, 1.6, -0.9, -68, -62, { plaster: 3 });
  add(shed(-1.65, 1.65, -0.9, 0.1, -0.35, -68, -62, { kind: 'tinRoof' }));

  // ---- gap (3 m) ----
  // ---- H: the relay terrace ----
  const hY = -1.6;
  walls(-3, 3, hY, -85, -71, { walk: true, kind: 'terrace', plaster: 4 });
  add(boxSpan(-3, -2.75, hY, hY + 0.45, -85, -71, { kind: 'parapet', walk: true }));
  add(boxSpan(2.75, 3, hY, hY + 0.45, -85, -71, { kind: 'parapet', walk: true }));
  add(boxSpan(-2.75, 2.75, hY, hY + 0.45, -85, -84.75, { kind: 'parapet', walk: true }));
  const relay = { x: 0, y: hY, z: -80 };
  decor.push({ kind: 'lamp', x: -2.6, y: hY + 1.6, z: -74, color: 'warm' });

  // ---- the city around the route ----
  scenery(world, decor);

  return {
    decor, vents, fragments, unstable, relay,
    tower: { x: 26, z: -240, base: STREET_Y, height: 74 },
    spawn: [0, 0, 1.5],
    endZ: -84,
    checkpoints: [[0, 0, 1.5], [0.2, 0.5, -15.6], [0.2, 0.5, -31], [-0.2, 0.1, -47.2], [-0.15, 0.1, -57.5], [0, 0.1, -62.6], [0, hY, -72.5]]
  };
}

// The neighbourhood: blocks on both sides of the route, close enough to
// read as one dense city, with roofs at many heights and orientations, big
// industrial pipes crossing high above the alleys, and distant layers that
// rise toward the tower. Seeded, so the city is the same every visit.
function scenery(world, decor) {
  const rng = makeRng(1702);
  const corridor = z => z > -5 ? 1.9 : z > -30 ? 3 : z > -62 ? 2.9 : z > -71 ? 2 : 3.3;
  // near ring: blocks hugging the route on both sides
  for (const side of [-1, 1]) {
    let z = 6;
    while (z > -100) {
      const len = 4 + rng() * 6, zf = z - len;
      const inner = Math.max(corridor(z), corridor(zf), corridor((z + zf) / 2)) + 0.4 + rng() * 1.6;
      const w = 4 + rng() * 5;
      const x0 = side < 0 ? -inner - w : inner, x1 = side < 0 ? -inner : inner + w;
      const top = -3.5 + rng() * 5.5;
      const roof = rng();
      world.add(boxSpan(x0, x1, STREET_Y, top, zf, z, { kind: 'building', far: true, plaster: (rng() * 5) | 0 }));
      if (roof < 0.45) world.add(gableZ(x0 - 0.15, x1 + 0.15, top, top + 0.3, top + 0.3 + (x1 - x0) * 0.32, zf - 0.15, z + 0.15, { kind: 'roof', far: true }));
      else if (roof < 0.8) world.add(gableX(x0 - 0.15, x1 + 0.15, top, top + 0.3, top + 0.3 + len * 0.3, zf - 0.15, z + 0.15, { kind: 'roof', far: true }));
      else { decor.push({ kind: 'tank', x: (x0 + x1) / 2, y: top, z: (z + zf) / 2, r: 0.7, h: 1.3 }); }
      if (rng() < 0.5) decor.push({ kind: 'stack', x: lerp(x0, x1, 0.2 + rng() * 0.6), y: top, z: lerp(zf, z, 0.3 + rng() * 0.4), h: 1.5 + rng() * 2 });
      z = zf - (rng() < 0.3 ? 1.2 : 0.15);
    }
  }
  // great pipes crossing high above the route, between the blocks
  for (const [z, y, r] of [[-11.5, 5.4, 0.45], [-34, 6.2, 0.7], [-52, 4.8, 0.38], [-77, 5.8, 0.55]]) decor.push({ kind: 'crossPipe', x0: -12, x1: 12, y, z, r });
  // far rings: rooflines climbing toward the tower
  for (let ring = 0; ring < 3; ring++) {
    for (let z = 10; z > -230; z -= 7 + ring * 3) {
      for (const side of [-1, 1]) {
        if (rng() < 0.15) continue;
        const x = side * (16 + ring * 14 + rng() * 10), w = 6 + rng() * 6, d = 5 + rng() * 4;
        const top = -4 + ring * 3 + rng() * 6 + Math.max(0, -z - 80) * 0.03;
        decor.push({ kind: 'farBlock', x, z, w, d, top, roof: rng() < 0.6 ? (rng() < 0.5 ? 'z' : 'x') : null, stack: rng() < 0.25 });
      }
    }
  }
}
