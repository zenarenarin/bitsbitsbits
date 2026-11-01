const { U, G, World, Catalog } = require('./load')();
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log('FAIL', m); } else console.log('ok  ', m); };
const dr = World.makeDrawer(44, 32, 9);
const body = (id, p, q) => { const b = World.makeBody(id, Catalog.byId[id]); World.setPose(b, p, q || [0,0,0,1]); return b; };
const t0 = Date.now();
// A. vase upright is too tall
let v = body('vase', [-12, 10, -10]); let r = World.settle(v, [], dr);
ok(!r.ok && r.reason === 'tall', 'upright vase rejected as too tall: ' + r.reason);
// E. vase lying on its side fits (tips to rest on belly + lip)
v = body('vase', [-6, 8, -10], U.qAxis(0, 0, 1, Math.PI / 2)); r = World.settle(v, [], dr);
ok(r.ok, 'vase on its side settles: ' + r.reason + ' frames ' + r.frames.length + ' top ' + v.box[4].toFixed(2));
// B. journal dims
const j = body('journal', [8, 6, 0]); r = World.settle(j, [v], dr);
const e = World.extents(j);
ok(r.ok && Math.abs(e[1] - 3.4) < 0.05 && Math.abs(j.box[1]) < 0.05, 'journal rests on floor, height ' + e[1].toFixed(2) + ' footprint ' + e[0].toFixed(2) + 'x' + e[2].toFixed(2));
// C. partly outside
const nb = body('notebook', [21, 8, 0]); r = World.settle(nb, [j], dr);
ok(!r.ok && r.reason === 'outside', 'notebook over right wall rejected: ' + r.reason + ' ' + r.side);
// F. stack notebook on journal
World.setPose(nb, [8, 6, 0], [0,0,0,1]); r = World.settle(nb, [j], dr);
ok(r.ok && Math.abs(nb.box[1] - j.box[4]) < 0.05 && r.supporters.includes(j), 'notebook rests on journal at y=' + nb.box[1].toFixed(2));
// D. overlap at start (lowered into the journal)
const nb2 = body('notebook', [8, 2, 0]); r = World.settle(nb2, [j, nb], dr);
ok(!r.ok && r.reason === 'overlap', 'lowered notebook inside journal rejected: ' + r.reason);
// frame upright topples flat
const fr = body('frame', [-12, 0.5, 2], U.qAxis(1, 0, 0, 0.35)); r = World.settle(fr, [v, j, nb], dr);
ok(r.ok && World.extents(fr)[1] < 1.6, 'frame stood upright falls flat: height ' + World.extents(fr)[1].toFixed(2) + ' frames ' + r.frames.length);
// teapot on floor, check handle accounted: put cup touching the handle side
const tp = body('teapot', [8, 3, -10]); r = World.settle(tp, [v, j, nb, fr], dr);
ok(r.ok, 'teapot settles upright');
// a box pushed into the handle should collide
const cupb = body('notebook', [8 - 5.2 - 1.0, 4, -10]); // notebook half width 3 -> right edge at -13.2+3 = -10.2 ; handle reaches -13.15
ok(!!World.overlapWith(cupb, [tp]), 'notebook overlapping the teapot handle is detected');
World.setPose(cupb, [8 - 5.6 - 3.0 - 0.05, 4, -10], [0,0,0,1]);
ok(!World.overlapWith(cupb, [tp]), 'notebook just clear of handle tip is free');
// key nests inside bowl
const bw = body('bowl', [-4, 1, 10]); const R0 = World.settle(bw, [v, j, nb, fr, tp], dr); ok(R0.ok, 'bowl placed ' + R0.reason);
const ky = body('key', [-4, 6, 10], U.qAxis(0, 1, 0, 0.3)); r = World.settle(ky, [v, j, nb, fr, tp, bw], dr);
ok(r.ok && ky.box[1] < bw.box[4] - 1.5, 'key drops down into the bowl: key bottom ' + ky.box[1].toFixed(2) + ' key top ' + ky.box[4].toFixed(2) + ' bowl top ' + bw.box[4].toFixed(2) + ' ' + r.reason);
// validate arrangement
const probs = World.validate([v, j, nb, fr, tp, bw, ky], dr);
ok(probs.length === 0, 'arrangement validates: ' + JSON.stringify(probs));
// flower upright topples
const fl = body('flower', [-14, 2, 12]); r = World.settle(fl, [], dr);
ok(r.ok, 'flower stood on its stem falls over: ' + r.reason + ' h ' + World.extents(fl)[1].toFixed(2));
console.log('time', Date.now() - t0, 'ms');
console.log(fails ? fails + ' failures' : 'all world checks passed');
