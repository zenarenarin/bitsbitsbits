// Prove skill routes with the real controller following waypoints: {x, z, jump(at z), sprint}
const L = require('./load')('Phys, Player, Builder, buildSegment, makeRng, MOVE');
function runRoute(name, seed, plan, opts) {
  const P = new L.Phys();
  const lead = new L.Builder(P, [0, 0, 8], -1, L.makeRng(1), 0); lead.deck(0, -8, { w: 8 });
  const m = L.buildSegment(P, name, seed, 0, [0, 0, 0], 0);
  const tail = new L.Builder(P, m.exitPos, 1, L.makeRng(2), 0); tail.deck(0, -8, { w: 8 });
  const pl = new L.Player(P); P.player = pl; pl.reset([0, 0.02, 4]);
  let wi = 0, t = 0;
  while (t < 30) {
    const w = plan[Math.min(wi, plan.length - 1)];
    const zl = pl.pos[2] - m.origin[2];
    if (wi < plan.length && zl < w.z) wi++;
    const tx = m.origin[0] + (w.x || 0);
    const inp = { steer: Math.max(-1, Math.min(1, (tx - pl.pos[0]) * 1.2)), pace: w.pace !== undefined ? w.pace : (opts.sprint ? 1 : 0), jumpPressed: !!(w.jump && Math.abs(zl - w.z) < 0.25), jumpHeld: true };
    if (opts.act && t > opts.act.t && !opts.act.done) { opts.act.done = true; const o = m.keys[opts.act.key]; o.isConn ? P.sever(o) : P.dismantle(o, o.hp); }
    pl.step(1 / 60, inp, 0); P.step(1 / 60); t += 1 / 60;
    if (pl.pos[1] < -12) return { ok: false, why: 'fell', z: zl.toFixed(1), wi };
    if (pl.pos[2] < m.exitPos[2] - 2) return { ok: true, t: t.toFixed(1) };
  }
  return { ok: false, why: 'timeout', z: (pl.pos[2] - m.origin[2]).toFixed(1), y: pl.pos[1].toFixed(1), wi };
}
const show = (n, r) => console.log((r.ok ? 'PASS ' : 'FAIL ') + n + ' ' + JSON.stringify(r));
for (const seed of [100, 8019, 16038]) {
  const mr = L.buildSegment(new L.Phys(), 'root', seed, 0, [0, 0, 0], 0);
  const edge = -7;
  show('root sprint jump s' + seed, runRoute('root', seed, [{ x: -0.6, z: edge + 0.3, jump: true }, { x: -0.9, z: -40 }], { sprint: true }));
  { const r = runRoute('root', seed, [{ x: -0.6, z: edge + 0.3, jump: true }, { x: -0.6, z: -40 }], {}); console.log((r.ok ? 'FAIL ' : 'PASS ') + 'root gap is impossible at cruise s' + seed); }
  show('lift climb s' + seed, runRoute('lift', seed, [{ x: 3.2, z: -6.6, jump: true }, { x: 3.4, z: -8.7, jump: true }, { x: 3.2, z: -11.0, jump: true }, { x: 2.6, z: -12.6, jump: true }, { x: -1, z: -60 }], {}));
  show('drawbridge root route s' + seed, runRoute('drawbridge', seed, [{ x: 3.1, z: -2 }, { x: 3.1, z: -8 - (mr.len ? 0 : 0) - 2.25, jump: true }, { x: 3.1, z: -14 }, { x: 0.8, z: -60 }], {}));
  show('cradle jump across s' + seed, runRoute('cradle', seed, [{ x: 0, z: -5.75, jump: true }, { x: 0, z: -6 - 2.6 - 5.2 + 0.1, jump: true }, { x: 0, z: -80 }], {}));
  show('sluice posts s' + seed, runRoute('sluice', seed, [{ x: -2.7, z: -5.75, jump: true }, { x: -3.0, z: -10.3, jump: true }, { x: -3.0, z: -15.4 }, { x: -1.2, z: -60 }], {}));
  show('counterpoise ride s' + seed, runRoute('counterpoise', seed, [{ x: 0, z: -80 }], {}));
}
