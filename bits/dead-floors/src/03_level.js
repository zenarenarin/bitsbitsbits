// Level generation: one big building per run, rooms joined by corridors on a grid,
// with the arrival elevator in a corner room.
// Grid values: 0 solid, 1 open, 2 start elevator (3 = exit elevator, unused in survival).
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function genLevel(seed) {
  const R = mulberry32(seed);
  const ri = (a, b) => Math.floor(a + R() * (b - a + 1));
  const floor = 8; // scales clutter and blood
  const N = 30;
  const g = new Uint8Array(N * N);
  const roomOf = new Int16Array(N * N).fill(-1);
  const rooms = [];
  const id = (x, y) => y * N + x;
  const inb = (x, y) => x >= 0 && y >= 0 && x < N && y < N;

  function addRoom(x, y, w, h, kind = 'room') {
    const r = { x, y, w, h, cx: x + (w - 1) / 2, cy: y + (h - 1) / 2, id: rooms.length, kind };
    rooms.push(r);
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) { g[id(i, j)] = 1; roomOf[id(i, j)] = r.id; }
    return r;
  }
  function free(x, y, w, h) {
    for (const r of rooms) if (!(x + w + 1 <= r.x || r.x + r.w + 1 <= x || y + h + 1 <= r.y || r.y + r.h + 1 <= y)) return false;
    return true;
  }
  function open(x, y) { if (inb(x, y) && g[id(x, y)] === 0) g[id(x, y)] = 1; }
  function carve(A, B) {
    let x = Math.round(A.cx), y = Math.round(A.cy);
    const tx = Math.round(B.cx), ty = Math.round(B.cy);
    const sx = () => { while (x !== tx) { x += Math.sign(tx - x); open(x, y); } };
    const sy = () => { while (y !== ty) { y += Math.sign(ty - y); open(x, y); } };
    if (R() < 0.5) { sx(); sy(); } else { sy(); sx(); }
  }

  let startRoom;
  {
    const corner = ri(0, 3);
    const sxp = corner & 1 ? N - 5 - ri(0, 2) : 2 + ri(0, 2);
    const syp = corner & 2 ? N - 5 - ri(0, 2) : 2 + ri(0, 2);
    startRoom = addRoom(sxp, syp, 3, 3, 'start');
    const target = 15;
    for (let t = 0; t < 600 && rooms.length < target; t++) {
      const w = ri(2, 5), h = ri(2, 5), x = ri(2, N - 2 - w), y = ri(2, N - 2 - h);
      if (free(x, y, w, h)) addRoom(x, y, w, h);
    }
    // Minimum spanning tree over room centres, plus a few loops.
    const inT = [0], rest = rooms.slice(1).map(r => r.id), conn = [];
    while (rest.length) {
      let best = null, bd = 1e9;
      for (const a of inT) for (const b of rest) {
        const d = Math.abs(rooms[a].cx - rooms[b].cx) + Math.abs(rooms[a].cy - rooms[b].cy);
        if (d < bd) { bd = d; best = [a, b]; }
      }
      conn.push(best); inT.push(best[1]); rest.splice(rest.indexOf(best[1]), 1);
    }
    for (let k = 0; k < Math.floor(rooms.length / 3); k++) { const a = ri(0, rooms.length - 1), b = ri(0, rooms.length - 1); if (a !== b) conn.push([a, b]); }
    for (const [a, b] of conn) carve(rooms[a], rooms[b]);
  }

  // BFS distances over open cells.
  function bfs(sx, sy) {
    const d = new Int16Array(N * N).fill(-1); const q = [id(sx, sy)]; d[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const k = q[h], x = k % N, y = (k / N) | 0;
      for (const [dx, dy] of DIR4) { const nx = x + dx, ny = y + dy; if (!inb(nx, ny)) continue; const nk = id(nx, ny); if (g[nk] === 1 && d[nk] < 0) { d[nk] = d[k] + 1; q.push(nk); } }
    }
    return d;
  }
  const sc = [Math.round(startRoom.cx), Math.round(startRoom.cy)];
  const dStart = bfs(sc[0], sc[1]);
  // Drop anything unreachable (should not happen, but be safe).
  for (let k = 0; k < N * N; k++) if (g[k] === 1 && dStart[k] < 0) { g[k] = 0; roomOf[k] = -1; }

  function elevatorSpots(room) {
    const c = [];
    for (let j = room.y; j < room.y + room.h; j++) for (let i = room.x; i < room.x + room.w; i++) {
      if (g[id(i, j)] !== 1) continue;
      for (const [dx, dy] of DIR4) {
        const ex = i + dx, ey = j + dy;
        if (ex < 1 || ey < 1 || ex > N - 2 || ey > N - 2 || g[id(ex, ey)] !== 0) continue;
        let ok = true;
        for (const [qx, qy] of DIR4) { const nx = ex + qx, ny = ey + qy; if (nx === i && ny === j) continue; if (g[id(nx, ny)] !== 0) ok = false; }
        if (ok) c.push({ ex, ey, rx: i, ry: j, dx, dy });
      }
    }
    return c;
  }
  const sSpots = elevatorSpots(startRoom);
  if (!sSpots.length) return genLevel((seed + 7777) >>> 0);
  const start = sSpots[ri(0, sSpots.length - 1)];
  g[id(start.ex, start.ey)] = 2;
  const exit = null;

  const nearWall = (i, j) => DIR4.some(([dx, dy]) => g[id(i + dx, j + dy)] !== 1);
  const isDoorCell = (i, j) => i === start.rx && j === start.ry;

  // Ceiling lights.
  const lights = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    if (g[id(i, j)] !== 1) continue;
    const inRoom = roomOf[id(i, j)] >= 0;
    if (inRoom ? (i + j) % 2 === 0 : (i * 7 + j * 3) % 4 === 0) {
      const r = R();
      const state = r < 0.13 ? 'off' : r < 0.27 ? 'flicker' : 'on';
      const warm = R() < 0.5;
      lights.push({ x: (i + 0.5) * CELL, z: (j + 0.5) * CELL, state, color: warm ? 0xffd9a8 : 0xd6ecff, rot: R() < 0.5 ? 0 : Math.PI / 2, phase: R() * 100 });
    }
  }
  // Props against walls.
  const props = [];
  const used = new Set();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = id(i, j);
    if (g[k] !== 1 || roomOf[k] < 0 || roomOf[k] === startRoom.id || isDoorCell(i, j) || !nearWall(i, j)) continue;
    if (R() > 0.24) continue;
    const walls = DIR4.filter(([dx, dy]) => g[id(i + dx, j + dy)] === 0);
    if (!walls.length) continue;
    const [dx, dy] = walls[ri(0, walls.length - 1)];
    const r = R();
    const type = r < 0.32 ? 'crate' : r < 0.55 ? 'barrel' : r < 0.78 ? 'desk' : 'cabinet';
    const dims = { crate: [0.9, 0.9, 0.9], barrel: [0.62, 0.95, 0.62], desk: [1.5, 0.78, 0.75], cabinet: [0.6, 1.35, 0.55] }[type];
    const along = dx !== 0 ? 'z' : 'x';
    // Depth is dims[2] facing out from the wall.
    const depth = dims[2], width = dims[0];
    const cx = (i + 0.5) * CELL + dx * (CELL / 2 - depth / 2 - 0.06) + (along === 'x' ? (R() - 0.5) * (CELL - width - 0.4) : 0);
    const cz = (j + 0.5) * CELL + dy * (CELL / 2 - depth / 2 - 0.06) + (along === 'z' ? (R() - 0.5) * (CELL - width - 0.4) : 0);
    const rotY = dx !== 0 ? Math.PI / 2 : 0;
    const hx = dx !== 0 ? depth / 2 : width / 2, hz = dx !== 0 ? width / 2 : depth / 2;
    props.push({ type, x: cx, z: cz, rotY: rotY + (type === 'crate' ? (R() - 0.5) * 0.3 : 0), dims, hx, hz });
    used.add(k);
    if (type === 'crate' && R() < 0.35) props.push({ type: 'crate', x: cx, z: cz, y: 0.9, rotY: rotY + (R() - 0.5) * 0.6, dims: [0.7, 0.7, 0.7], hx: 0, hz: 0, stacked: true });
  }

  // Pickups.
  const roomCells = [];
  for (let k = 0; k < N * N; k++) if (g[k] === 1 && roomOf[k] >= 0) roomCells.push(k);
  const pickups = [];
  function placePickup(kind, k) {
    const i = k % N, j = (k / N) | 0;
    pickups.push({ kind, x: (i + 0.5 + (R() - 0.5) * 0.4) * CELL, z: (j + 0.5 + (R() - 0.5) * 0.4) * CELL });
  }
  const startCells = roomCells.filter(k => roomOf[k] === startRoom.id && !(k % N === start.rx && ((k / N) | 0) === start.ry));
  placePickup('ammo', startCells[ri(0, startCells.length - 1)]);
  const others = roomCells.filter(k => roomOf[k] !== startRoom.id);
  // Scarce: a couple of boxes to start; more appear one at a time during the run.
  const nAmmo = 2;
  const nMed = 1;
  for (let a = 0; a < nAmmo; a++) placePickup('ammo', others[ri(0, others.length - 1)]);
  for (let a = 0; a < nMed; a++) placePickup('med', others[ri(0, others.length - 1)]);

  // Blood on the floor and walls.
  const decals = [];
  const openCells = [];
  for (let k = 0; k < N * N; k++) if (g[k] === 1) openCells.push(k);
  for (let a = 0; a < 14 + floor * 2 && a < 60; a++) {
    const k = openCells[ri(0, openCells.length - 1)];
    decals.push({ wall: false, x: ((k % N) + 0.15 + R() * 0.7) * CELL, z: (((k / N) | 0) + 0.15 + R() * 0.7) * CELL, s: 0.7 + R() * 1.6, v: ri(0, 2), r: R() * TAU });
  }
  for (let a = 0; a < 10 + floor && a < 40; a++) {
    const k = openCells[ri(0, openCells.length - 1)], i = k % N, j = (k / N) | 0;
    const walls = DIR4.filter(([dx, dy]) => g[id(i + dx, j + dy)] === 0);
    if (!walls.length) continue;
    const [dx, dy] = walls[ri(0, walls.length - 1)];
    const off = (R() - 0.5) * (CELL - 1);
    decals.push({ wall: true, x: (i + 0.5) * CELL + dx * (CELL / 2 - 0.012) + (dy !== 0 ? off : 0), z: (j + 0.5) * CELL + dy * (CELL / 2 - 0.012) + (dx !== 0 ? off : 0), y: 0.4 + R() * 1.6, nx: -dx, nz: -dy, s: 0.6 + R() * 1.2, v: ri(0, 2), r: R() * TAU });
  }

  // Cells where zombies may appear later: open, not the start room, not elevators.
  const spawnCells = openCells.filter(k => roomOf[k] !== startRoom.id && dStart[k] > 3);
  return { N, g, roomOf, rooms, startRoom, start, exit, boss: false, arena: null, lights, props, pickups, decals, spawnCells, dStart, roomCells };
}
