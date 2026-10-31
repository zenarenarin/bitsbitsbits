// =====================================================================
// PHASE 1 — the Movement Lab. One short, authored stretch of rooftops
// holding the five things the movement has to feel right on:
//   A  wide concrete roof (steer around a tank stand and a stair room)
//   gap (2.6 m, slightly down)
//   B  roof with a low passage: duck under a pipe bundle between a
//      stair room and a tank platform (or jump onto the platform)
//   narrow ledge (0.4 m) across a void, entered through a parapet gap
//   C  a short roof, then a drop gap onto
//   D  the landing terrace
// Pure data: collision boxes carry a `kind` the renderer turns into
// architecture. Nothing here knows about three.js.
// =====================================================================

const STREET_Y = -14;

function buildLab(world) {
  const decor = [];
  const add = b => world.add(b);
  const building = (x0, x1, top, zFar, zNear, tags) => add(boxSpan(x0, x1, STREET_Y, top, zFar, zNear, Object.assign({ kind: 'building', walk: true }, tags)));
  const parapet = (x0, x1, top, zFar, zNear, h) => add(boxSpan(x0, x1, top, top + (h || 0.42), zFar, zNear, { kind: 'parapet', walk: true }));

  // ---- A: wide roof ----
  building(-4.5, 4.5, 0, -30, 8);
  parapet(-4.5, -4.25, 0, -30, 8); parapet(4.25, 4.5, 0, -30, 8); parapet(-4.25, 4.25, 0, 7.75, 8);
  add(boxSpan(1.5, 3.7, 0, 1.55, -14.6, -12.2, { kind: 'tankStand' }));        // black tank on a stand
  add(boxSpan(-4.25, -1.6, 0, 2.5, -22.5, -17.5, { kind: 'room' }));          // stair room
  decor.push({ kind: 'dish', x: 3.6, y: 0.42, z: 2, face: -0.6 });
  decor.push({ kind: 'pipeRun', x: -4.15, y: 0.1, z0: -29, z1: 6 });
  decor.push({ kind: 'laundry', x0: -1.6, x1: 4.25, y: 1.9, z: -6, poles: true });
  decor.push({ kind: 'crates', x: -3.5, y: 0, z: -4 });

  // ---- gap 1 (2.6 m) ----
  // ---- B: roof with the low passage ----
  const bY = -0.35;
  building(-3.6, 3.6, bY, -50, -32.6);
  parapet(3.35, 3.6, bY, -49.75, -32.6);
  add(boxSpan(-3.6, -0.5, bY, bY + 2.6, -42.4, -38.6, { kind: 'room' }));            // stair room, left
  add(boxSpan(1.0, 3.35, bY, bY + 0.88, -43.4, -37.6, { kind: 'platform', walk: true })); // tank platform, right
  decor.push({ kind: 'tank', x: 2.6, y: bY + 0.88, z: -42.2, r: 0.6, h: 1.0 });
  // the pipe bundle bridging room and platform: 0.3 m of clearance under it
  add(boxSpan(-0.5, 1.0, bY + 0.3, bY + 0.62, -40.9, -39.9, { kind: 'pipes', cam: 'fade', walk: true }));
  // the far parapet, open where the ledge begins
  parapet(-3.6, 0.85, bY, -50, -49.75, 0.45); parapet(1.95, 3.35, bY, -50, -49.75, 0.45);

  // ---- narrow ledge across the void ----
  add(boxSpan(1.2, 1.6, bY - 0.3, bY, -60, -50, { kind: 'ledge', walk: true, narrow: true }));
  decor.push({ kind: 'cable', a: [-3.6, 2.6, -49.8], b: [-1, 3.4, -60.2] });
  decor.push({ kind: 'cable', a: [3.6, 2.2, -49.8], b: [3.4, 2.9, -60.2] });

  // ---- C: a short roof, the run-up for the drop ----
  building(-0.6, 3.4, bY, -66, -60);
  parapet(3.15, 3.4, bY, -66, -60);

  // ---- gap 2 (3.0 m, 1.25 m drop) ----
  // ---- D: the landing terrace ----
  const dY = -1.6;
  building(-5, 5, dY, -96, -69);
  parapet(-5, -4.75, dY, -96, -69); parapet(4.75, 5, dY, -96, -69);
  decor.push({ kind: 'laundry', x0: -4.75, x1: 1.5, y: dY + 1.9, z: -78, poles: true });
  decor.push({ kind: 'laundry', x0: -2, x1: 4.75, y: dY + 2.0, z: -84, poles: true });
  decor.push({ kind: 'dish', x: -4.2, y: dY + 0.42, z: -90, face: 0.7 });
  decor.push({ kind: 'tank', x: 3.6, y: dY, z: -92, r: 0.55, h: 1.0 });

  // neighbours that frame the route (not reachable, never on the path)
  const neighbours = [
    [-11, -5.2, 1.4, -20, 10], [5.2, 12, -2, -26, 10], [-12, -4.4, 4.5, -60, -24],
    [4.4, 11, 1.2, -52, -30], [-9, -1.2, -3.5, -68, -51], [4.2, 10, 2.5, -68, -54],
    [-13, -5.6, 1.6, -100, -70], [5.6, 12, -0.4, -102, -70]
  ];
  for (const [x0, x1, top, zf, zn] of neighbours) add(boxSpan(x0, x1, STREET_Y, top, zf, zn, { kind: 'building', far: true }));

  return {
    decor,
    spawn: [0, 0, 3],
    endZ: -95,
    // respawn points, in order along the route
    checkpoints: [[0, 0, 3], [0, bY, -34], [1.4, bY, -46.5], [1.4, bY, -61.5], [0, dY, -71.5]]
  };
}
