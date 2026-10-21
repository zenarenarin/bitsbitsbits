// The playable slice, proven with the real controller and real erasure.
// Each route follows waypoints {x, z, jump, pace}; acts fire when the traveller
// passes a local z. Reports where the traveller crossed (high road or low).
const L = require('./load')('Phys, Player, Builder, buildSegment, makeRng, MOVE');
function runRoute(seed, plan, acts, opts) {
  opts = opts || {};
  const P = new L.Phys();
  const lead = new L.Builder(P, [0, 0, 8], -1, L.makeRng(1), 0); lead.deck(0, -8, { w: 8 });
  const m = L.buildSegment(P, opts.fam || 'threshold', seed, opts.d || 0, [0, 0, 0], 0);
  const tail = new L.Builder(P, m.exitPos, 1, L.makeRng(2), 0); tail.deck(0, -8, { w: 8 });
  const pl = new L.Player(P); P.player = pl; pl.reset([0, 0.02, 4]);
  let wi = 0, t = 0, minY = 0, deaths = [];
  const evs = [];
  while (t < 40) {
    const w = plan[Math.min(wi, plan.length - 1)];
    const zl = pl.pos[2] - m.origin[2];
    if (wi < plan.length && zl < w.z) wi++;
    const tx = m.origin[0] + (w.x || 0);
    const jumpAt = w.jump && Math.abs(zl - w.z) < 0.25;
    const inp = { steer: Math.max(-1, Math.min(1, (tx - pl.pos[0]) * 1.2)), pace: w.pace !== undefined ? w.pace : (opts.sprint ? 1 : 0), jumpPressed: !!jumpAt, jumpHeld: true };
    for (const a of acts) if (!a.done && zl < a.z) { a.done = true; const o = m.keys[a.key]; if (o.isConn) P.sever(o); else P.erase(o); }
    pl.step(1 / 60, inp, 0); P.step(1 / 60); t += 1 / 60;
    for (const e of P.events) if (e.type === 'land' || e.type === 'release' || e.type === 'chain') evs.push(e.type);
    P.events.length = 0;
    for (const e of pl.events) if (e.type === 'death') deaths.push(e.reason);
    pl.events.length = 0;
    minY = Math.min(minY, pl.pos[1]);
    if (!pl.alive) return { ok: false, why: 'death:' + deaths.join(','), z: zl.toFixed(1) };
    if (pl.pos[1] < -12) return { ok: false, why: 'fell', z: zl.toFixed(1), wi };
    if (pl.pos[2] < m.exitPos[2] - 2) return { ok: true, road: minY < -2 ? 'low' : 'high', t: +t.toFixed(1), evs: [...new Set(evs)].join(' ') };
  }
  return { ok: false, why: 'timeout', z: (pl.pos[2] - m.origin[2]).toFixed(1), y: pl.pos[1].toFixed(1), wi };
}
let pass = 0, total = 0;
const expect = (name, r, want) => { total++; const good = want(r); if (good) pass++; console.log((good ? 'PASS ' : 'FAIL ') + name + ' ' + JSON.stringify(r)); };
for (const seed of [100, 8019, 16038, 24057]) {
  const m = L.buildSegment(new L.Phys(), 'threshold', seed, 0, [0, 0, 0], 0);
  const zB = m.keys.floor.pos[2] - m.keys.floor.size[2];             // end of the infill
  const zG = zB - m.keys.wall.pos[2] * 0 - (m.keys.lintel.pos[2] - m.keys.lintel.size[2] + 1.3 - zB) * 0; // placeholder
  const edge = m.keys.lintel.pos[2] + m.keys.lintel.size[2] - 1.3;    // the high road's lip
  const stairX = -2.9;
  const zc1 = edge - (m.keys.lintel.size[2] - 1.3) * 2 - 4.5;
  const lowPlan = [{ x: 0, z: edge - 2.9 }, { x: stairX, z: zc1 - 8.2 }];
  // the low road's stair: jump each step
  const steps = []; { const zc1_ = edge - (m.keys.lintel.size[2] - 1.3) * 2 - 4.5; for (let i = 0; i < 0; i++) steps.push({ x: stairX, z: zc1 + 0.95 - i * 1.3, jump: true }); }
  void zG;
  expect('s' + seed + ' nothing unmade: the wall holds', runRoute(seed, [{ x: 0, z: -80 }], []), r => !r.ok);
  expect('s' + seed + ' wall + sprint leap: high road', runRoute(seed, [{ x: 0, z: edge + 0.35, jump: true, pace: 1 }, { x: 0, z: -80, pace: 1 }], [{ key: 'wall', z: 2 }]), r => r.ok && r.road === 'high');
  expect('s' + seed + ' wall + cruise leap falls short into the old street', runRoute(seed, [{ x: 0, z: edge + 0.3, jump: true }, ...lowPlan.slice(1), ...steps, { x: 0, z: -80 }], [{ key: 'wall', z: 2 }]), r => r.ok && r.road === 'low');
  expect('s' + seed + ' wall + props: lintel bridge at cruise', runRoute(seed, [{ x: 0, z: edge + 0.6, jump: true }, { x: 0, z: -80 }], [{ key: 'wall', z: 2 }, { key: 'props', z: 1 }]), r => r.ok && r.road === 'high');
  expect('s' + seed + ' floor: drop to the old street, climb out', runRoute(seed, [...lowPlan, ...steps, { x: 0, z: -80 }], [{ key: 'floor', z: -2 }]), r => r.ok && r.road === 'low');
  expect('s' + seed + ' unmaking the props from beneath crushes', runRoute(seed, [{ x: 0, z: edge + 0.9 }, { x: 0, z: -80, pace: -1 }], [{ key: 'wall', z: 2 }, { key: 'props', z: edge + 0.85 }]), r => r.why === 'death:crushed');
}
// shutters: read the glaze at speed
for (const seed of [100, 8019, 16038, 24057]) {
  const m = L.buildSegment(new L.Phys(), 'shutters', seed, 0, [0, 0, 0], 0);
  const z1 = m.keys.w1.pos[2], z2 = m.keys.stone.pos[2], z3 = m.keys.w3.pos[2];
  const bx = m.bodies.find(b => b.style === 'beam').pos[0];
  const lip = z3 - 1.6 + 0.35;
  const S = { fam: 'shutters' };
  const round = [{ x: 0, z: z2 + 3.2 }, { x: bx, z: z2 - 2.2 }, { x: 0, z: lip, jump: true }, { x: 0, z: -80 }];
  expect('s' + seed + ' shutters: nothing unmade, the first glaze holds', runRoute(seed, [{ x: 0, z: -80 }], [], S), r => !r.ok);
  expect('s' + seed + ' shutters: unmaking only the glaze, the stone still blocks', runRoute(seed, [{ x: 0, z: lip, jump: true }, { x: 0, z: -80 }], [{ key: 'w1', z: 2 }, { key: 'w3', z: 2 }], S), r => !r.ok);
  expect('s' + seed + ' shutters: glaze, side beam round the stone, glaze, leap', runRoute(seed, round, [{ key: 'w1', z: 2 }, { key: 'w3', z: z2 }], S), r => r.ok);
  expect('s' + seed + ' shutters: forgetting the last shutter stops you at the lip', runRoute(seed, round, [{ key: 'w1', z: 2 }], S), r => !r.ok);
}
console.log(pass + '/' + total + ' slice checks');
