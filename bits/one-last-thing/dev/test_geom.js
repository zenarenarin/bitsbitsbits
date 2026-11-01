const { U, G, World, Catalog } = require('./load')();
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } };
// GJK vs analytic: two spheres
const mk = (part, p, q) => { const i = G.makeInst(part); G.poseInst(i, p, q || [0,0,0,1]); return i; };
const A = mk({ t: 'sph', r: 1 }, [0, 0, 0]), B = mk({ t: 'sph', r: 1.5 }, [3, 1, 0]);
ok(Math.abs(G.dist(A, B) - (Math.hypot(3, 1) - 2.5)) < 1e-3, 'sphere dist ' + G.dist(A, B));
// boxes
const b1 = mk({ t: 'box', h: [1, 1, 1] }, [0, 0, 0]), b2 = mk({ t: 'box', h: [1, 1, 1] }, [2.5, 0.3, 0]);
ok(Math.abs(G.dist(b1, b2) - 0.5) < 1e-6, 'box dist ' + G.dist(b1, b2));
const b3 = mk({ t: 'box', h: [1, 1, 1] }, [1.9, 0.3, 0.2], U.qAxis(0, 1, 0, 0.4));
ok(G.dist(b1, b3) === 0, 'box overlap');
// rotated box corner distance: box rotated 45deg about z placed so its corner points at b1
const b4 = mk({ t: 'box', h: [1, 1, 1] }, [1 + Math.SQRT2 + 0.3, 0, 0], U.qAxis(0, 0, 1, Math.PI / 4));
ok(Math.abs(G.dist(b1, b4) - 0.3) < 1e-6, 'corner dist ' + G.dist(b1, b4));
// frustum vs box
const f1 = mk({ t: 'fr', r0: 1, r1: 0.5, h: 2 }, [0, 0, 0]);
const b5 = mk({ t: 'box', h: [1, 1, 1] }, [0, 2.2, 0]);
ok(Math.abs(G.dist(f1, b5) - 0.2) < 1e-4, 'frustum top dist ' + G.dist(f1, b5));
const b6 = mk({ t: 'box', h: [1, 1, 1] }, [2.3, -0.9, 0]);
ok(Math.abs(G.dist(f1, b6) - 0.3) < 1e-3, 'frustum side ' + G.dist(f1, b6));
// random fuzz: compare overlap boolean with sampling for capsules vs spheres
const R = U.rng(5); let mism = 0;
for (let k = 0; k < 2000; k++) {
  const c = mk({ t: 'cap', a: [-1, 0, 0], b: [1, 0, 0], r: 0.4 }, [0, 0, 0], U.qNorm([R() - .5, R() - .5, R() - .5, R()]));
  const p = [R() * 4 - 2, R() * 4 - 2, R() * 4 - 2]; const s = mk({ t: 'sph', r: 0.5 }, p);
  const d = G.dist(c, s);
  // analytic: segment-point distance
  const ax = U.qRot(c.part.q || [0,0,0,1], [1,0,0]);
  const R3 = c.R; const dir = [R3[0], R3[3], R3[6]];
  let t = p[0]*dir[0]+p[1]*dir[1]+p[2]*dir[2]; t = Math.max(-1, Math.min(1, t));
  const q = [dir[0]*t, dir[1]*t, dir[2]*t]; const ad = Math.max(0, Math.hypot(p[0]-q[0], p[1]-q[1], p[2]-q[2]) - 0.9);
  if (Math.abs(ad - d) > 2e-3) mism++;
}
ok(mism === 0, 'capsule fuzz mismatches ' + mism);
// Catalog sanity: parts count & dims
for (const d of Catalog.list) {
  const b = World.makeBody(d.id, d);
  const e = World.extents(b);
  console.log(String(d.no).padStart(2), d.id.padEnd(11), 'parts', String(d.parts.length).padStart(2), 'size', e.map(v => v.toFixed(1)).join(' x '), 'minY', b.box[1].toFixed(2), 'com', b.com.map(v=>v.toFixed(1)).join(','));
}
console.log(fails ? fails + ' failures' : 'all geometry checks passed');
