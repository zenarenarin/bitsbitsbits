// Is unlimited unmaking trivial? For every family, unmake EVERYTHING eligible
// before arriving, settle the physics, and see whether a route still connects.
// If "erase it all" kept working everywhere, a capacity limit would be needed.
const L = require('./load')('Phys, Builder, buildSegment, surfacesOf, reachable, makeRng, FAMILIES');
for (const name of Object.keys(L.FAMILIES)) {
  if (L.FAMILIES[name].rest) continue;
  let ok = 0, n = 0;
  for (let i = 0; i < 12; i++) {
    const P = new L.Phys();
    const lead = new L.Builder(P, [0, 0, 6], -1, L.makeRng(1), 0); lead.deck(0, -6, {});
    const m = L.buildSegment(P, name, 100 + i * 7919, (i % 4) / 3, [0, 0, 0], 0);
    const tail = new L.Builder(P, m.exitPos, 1, L.makeRng(2), 0); tail.deck(0, -6, {});
    P.player = { pos: [0, 0, -1000] };
    for (const c of m.conns) if (c.alive && c.role) P.sever(c);
    for (const b of m.bodies) if (b.alive && b.erase) P.erase(b);
    for (let k = 0; k < 360; k++) P.step(1 / 60);
    const surfs = L.surfacesOf(P, [...lead.bodies, ...m.bodies, ...tail.bodies]);
    const from = surfs.find(x => x.body === lead.bodies[0]), to = surfs.find(x => x.body === tail.bodies[0]);
    n++; if (from && to && L.reachable(surfs, from, to, false)) ok++;
  }
  console.log(name.padEnd(13), 'erase-everything still crosses at cruise:', ok + '/' + n);
}
