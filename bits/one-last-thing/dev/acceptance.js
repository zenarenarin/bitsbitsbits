// Acceptance scenarios A-L from the brief, run against the built Bit in headless Chromium
// with real pointer input for the interactions. usage: node dev/acceptance.js [shotDir]
const open = require('./shot');
const out = process.argv[2];
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const { page, logs, close } = await open({ query: '' });
  await page.waitForTimeout(800);
  const E = (fn, arg) => page.evaluate(fn, arg);
  const shot = async n => { if (out) await page.screenshot({ path: `${out}/acc-${n}.png` }); };
  const L = await E(() => ({ slot: __olt.view.tray.slotPx, tr: __olt.view.view.trayRect }));
  const ty = L.tr.y + L.tr.h * 0.55;
  const scr = (x, z, y) => E(([x, z, y]) => __olt.view.project([x, y, z]), [x, z, y]);
  const drag = async (x0, y0, x1, y1, steps = 12) => { await page.mouse.move(x0, y0); await page.mouse.down(); for (let i = 1; i <= steps; i++) { await page.mouse.move(x0 + (x1 - x0) * i / steps, y0 + (y1 - y0) * i / steps); await page.waitForTimeout(16); } await page.waitForTimeout(120); await page.mouse.up(); await page.waitForTimeout(900); };
  const pickShelf = async id => { const i = await E(id => __olt.S.objs.filter(o => o.state === 'tray').findIndex(o => o.def.id === id), id); await E(i => { __olt.view.tray.scroll = Math.max(0, i * 10 - 10); }, i); await page.waitForTimeout(100); const sc = await E(() => __olt.view.tray.scroll); await page.mouse.click(L.slot / 2 + (i * 10 - sc) / 10 * L.slot, ty); await page.waitForTimeout(350); return E(() => __olt.S.held && __olt.S.held.obj.def.id); };
  const held = () => E(() => { const h = __olt.S.held; if (!h) return null; __olt.computeSettle(true); return { id: h.obj.def.id, ok: h.res.ok, reason: h.res.reason, q: h.q }; });
  const placed = () => E(() => __olt.S.objs.filter(o => o.state === 'placed').map(o => ({ id: o.def.id, p: o.body.p, q: o.body.q, box: Array.from(o.body.box) })));

  const findSpot = avoid => E(avoid => {
    const h = __olt.S.held, s = 0.7071, av = avoid && __olt.S.objs.find(o => o.def.id === avoid);
    for (const q of [[0, 0, 0, 1], [0, s, 0, s], [s, 0, 0, s], [0, 0, s, s], [0.5, 0.5, 0.5, 0.5], [0.5, 0.5, -0.5, 0.5]]) for (let z = -5; z <= 5; z += 1) for (let x = -8; x <= 8; x += 1) {
      h.q = q; h.cx = x; h.cz = z; h.lower = null; __olt.markDirty(); const r = __olt.computeSettle(true);
      if (r.ok && (!av || !__olt.G.boxOverlap(h.probe.box, av.body.box, 0.4))) return [x, z, q];
    }
    return null;
  }, avoid);
  const axes = () => E(() => { const q = __olt.S.held.q; const rot = (q, v) => { const [x, y, z, w] = q; const ix = w * v[0] + y * v[2] - z * v[1], iy = w * v[1] + z * v[0] - x * v[2], iz = w * v[2] + x * v[1] - y * v[0], iw = -x * v[0] - y * v[1] - z * v[2]; return [ix * w + iw * -x + iy * -z - iz * -y, iy * w + iw * -y + iz * -x - ix * -z, iz * w + iw * -z + ix * -y - iy * -x].map(a => Math.round(a * 1000) / 1000); }; return { up: rot(q, [0, 1, 0]), right: rot(q, [1, 0, 0]) }; });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

  // ---- A, C, E: drawer 1 ----
  ok(await pickShelf('vase') === 'vase', 'A  vase picked up from the shelf with a tap');
  let h = await held(); ok(!h.ok && h.reason === 'tall', 'E  upright vase is rejected as too tall (' + h.reason + ')');
  const a0 = await axes();
  await page.click('.olt-turn'); await page.waitForTimeout(250); const a1 = await axes();
  ok(same(a1.up, a0.up) && !same(a1.right, a0.right), 'A  TURN rotates about the vertical axis');
  await page.click('.olt-tip'); await page.waitForTimeout(250); const a2 = await axes();
  ok(!same(a2.up, a1.up) && Math.abs(a2.up[0]) < 1e-3, 'A  TIP rotates about the left-right axis');
  await page.click('.olt-roll'); await page.waitForTimeout(250); const a3 = await axes();
  ok(!same(a3.right, a2.right) && Math.abs(a3.right[2] - a2.right[2]) < 1e-3, 'A  ROLL rotates about the front-back axis');
  await page.click('.olt-fine'); await page.click('.olt-roll'); await page.waitForTimeout(250); const a4 = await axes();
  ok(Math.abs(angle(a4.right, a3.right) - Math.PI / 12) < 0.01, 'A  fine step rotates 15 degrees');
  await page.click('.olt-fine');
  const qBefore = (await held()).q;
  await E(() => { const c = document.querySelector('canvas'); const fire = (t, id, x, y) => c.dispatchEvent(new PointerEvent(t, { pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch', isPrimary: id === 11 })); fire('pointerdown', 11, 150, 330); fire('pointerdown', 12, 250, 330); for (let i = 1; i <= 10; i++) { const a = i / 10 * 0.8; fire('pointermove', 11, 200 - Math.cos(a) * 50, 330 - Math.sin(a) * 50); fire('pointermove', 12, 200 + Math.cos(a) * 50, 330 + Math.sin(a) * 50); } fire('pointerup', 11, 0, 0); fire('pointerup', 12, 0, 0); });
  await page.waitForTimeout(200);
  ok(!same((await held()).q, qBefore), 'A  two-finger twist turns the held object');
  await shot('A-held');
  await E(() => { __olt.S.held.q = [0, 0, 0, 1]; __olt.markDirty(); });
  await page.click('.olt-tip'); await page.waitForTimeout(200);
  h = await held(); ok(!h.ok && h.reason === 'outside', 'C  vase lying front-to-back sticks out of the 11.4 cm deep drawer (' + h.reason + ')');
  await shot('C-outside');
  await page.click('.olt-place'); await page.waitForTimeout(400);
  ok((await placed()).length === 0 && await E(() => !!__olt.S.held), 'C  the overhanging placement is refused and the vase stays in hand');
  await page.click('.olt-turn'); await page.waitForTimeout(250);
  h = await held(); ok(h.ok, 'E  turned along the width it fits');
  await page.click('.olt-place'); await page.waitForTimeout(1200);
  let P = await placed(); ok(P.length === 1 && P[0].id === 'vase' && P[0].box[4] <= 7.0 + 1e-6 && P[0].box[1] >= -1e-6, 'E  vase settled inside the drawer, top ' + (P[0] && P[0].box[4].toFixed(2)));

  // ---- D overlap ----
  await pickShelf('notebook');
  const vb = P[0].box;
  await E(vb => { const h = __olt.S.held; h.cx = (vb[0] + vb[3]) / 2; h.cz = (vb[2] + vb[5]) / 2; h.lower = 2; __olt.markDirty(); }, vb);
  await page.waitForTimeout(200);
  h = await held(); ok(!h.ok && h.reason === 'overlap', 'D  notebook lowered into the vase is rejected as overlapping (' + h.reason + ')');
  await shot('D-overlap');
  await page.click('.olt-place'); await page.waitForTimeout(500);
  ok((await placed()).length === 1 && await E(() => !!__olt.S.held), 'D  rejected placement stays held, nothing becomes permanent');
  ok(!!(await findSpot()), 'D  a valid free spot exists elsewhere');
  await page.click('.olt-place'); await page.waitForTimeout(1200);
  ok((await placed()).some(p => p.id === 'notebook'), 'D  notebook placed in the free spot');

  // ---- H undo ----
  await page.click('.olt-undo'); await page.waitForTimeout(300);
  P = await placed(); ok(P.length === 1 && P[0].id === 'vase', 'H  undo returns the notebook to the shelf and keeps the vase');

  // ---- G reposition: move the cup, the vase stays exactly where it is ----
  await pickShelf('cup');
  ok(!!(await findSpot()), 'G  free spot for the cup');
  await page.click('.olt-place'); await page.waitForTimeout(1500);
  P = await placed(); const vBefore = P.find(p => p.id === 'vase'), c0p = P.find(p => p.id === 'cup');
  ok(!!c0p, 'G  cup placed');
  // a screen point where a ray really hits the cup (not the vase in front of it)
  const cupPt = await E(() => { const o = __olt.S.objs.find(o => o.def.id === 'cup'), b = o.body.box, groups = __olt.S.objs.filter(o => o.state === 'placed').map(o => o.vis.group);
    for (let i = 0; i < 60; i++) { const p = __olt.view.project([b[0] + (b[3] - b[0]) * Math.random(), b[1] + (b[4] - b[1]) * Math.random(), b[2] + (b[5] - b[2]) * Math.random()]); const hit = __olt.view.pick(p[0], p[1], groups); if (hit && hit.obj === o) return p; } return null; });
  await page.mouse.click(cupPt[0], cupPt[1]); await page.waitForTimeout(300);
  ok(await E(() => __olt.S.held && __olt.S.held.obj.def.id === 'cup'), 'G  tapping the placed cup picks it up');
  const target = await E(() => { const h = __olt.S.held; for (let z = 5; z >= -5; z -= 0.5) for (let x = 9; x >= -9; x -= 0.5) { h.cx = x; h.cz = z; __olt.markDirty(); const r = __olt.computeSettle(true); if (r.ok && Math.hypot(r.final.p[2] - h.from.pose.p[2], r.final.p[0] - h.from.pose.p[0]) > 2) return __olt.view.project([x, __olt.S.dr.H + 0.9, z]); } return null; });
  ok(!!target, 'G  found somewhere else for the cup');
  await E(() => { const h = __olt.S.held; h.cx = h.from.pose.p[0]; h.cz = h.from.pose.p[2]; __olt.markDirty(); });
  if (target) await drag(target[0] - 30, target[1] + 10, target[0], target[1]);
  await page.waitForTimeout(800);
  P = await placed(); const c1p = P.find(p => p.id === 'cup'), vAfter = P.find(p => p.id === 'vase');
  ok(c1p && !same(c1p.p, c0p.p) && vAfter && same(vAfter.p, vBefore.p) && same(vAfter.q, vBefore.q), 'G  cup dragged to a new spot, the vase untouched');
  await shot('G-moved');

  // ---- I complete ----
  await pickShelf('notebook');
  ok(!!(await findSpot()), 'I  a valid spot for the last piece exists');
  await page.click('.olt-place');
  await page.waitForFunction(() => __olt.S.done && document.querySelector('.olt-result').classList.contains('on'), null, { timeout: 15000 }).catch(() => {});
  const done = await E(() => ({ done: __olt.S.done, problems: __olt.World.validate(__olt.S.objs.map(o => o.body), __olt.S.dr), card: document.querySelector('.olt-result').classList.contains('on') }));
  ok(done.done && done.problems.length === 0 && done.card, 'I  drawer complete, independently validated, result card shown ' + JSON.stringify(done) + JSON.stringify(await E(() => __olt.S.objs.map(o => o.state + ':' + o.def.id + (__olt.S.held ? ' held=' + __olt.S.held.obj.def.id : '')))));
  await shot('I-complete');

  // ---- B, F, J on drawer 2 ----
  await E(() => __olt.goLevel(1)); await page.waitForTimeout(500);
  const items = await E(() => __olt.S.lv.items.map(i => i.id).sort().join(','));
  const pj = await pickShelf('journal'); [sx, sy] = await scr(0, 0, 9);
  await drag(201, 330, sx, sy);
  const jb = await E(() => { const o = __olt.S.objs.find(o => o.def.id === 'journal'); return { st: o.state, e: __olt.World.extents(o.body), y0: o.body.box[1] }; });
  ok(jb.st === 'placed' && Math.abs(jb.e[1] - 3.4) < 0.05 && Math.abs(jb.y0) < 0.05, 'B  journal rests on the felt with its real 3.4 cm thickness (extents ' + jb.e.map(v => v.toFixed(2)).join(' x ') + ' cm) ' + JSON.stringify(jb) + JSON.stringify(await E(() => [__olt.S.held && __olt.S.held.res && __olt.S.held.res.reason, document.querySelector('.olt-toast').textContent])));
  await pickShelf('key');
  const jbox = await E(() => Array.from(__olt.S.objs.find(o => o.def.id === 'journal').body.box));
  await E(jb => { const h = __olt.S.held; h.cx = (jb[0] + jb[3]) / 2; h.cz = (jb[2] + jb[5]) / 2; __olt.markDirty(); }, jbox);
  await page.waitForTimeout(150);
  await page.click('.olt-place'); await page.waitForTimeout(1200);
  const kf = await E(() => { const k = __olt.S.objs.find(o => o.def.id === 'key'), j = __olt.S.objs.find(o => o.def.id === 'journal'); return { st: k.state, y0: k.body.box[1], jt: j.body.box[4], sup: __olt.World.contacts(k.body, [j.body]).supporters.length }; });
  ok(kf.st === 'placed' && Math.abs(kf.y0 - kf.jt) < 0.1 && kf.sup === 1, `F  key rests on top of the journal (key bottom ${kf.y0.toFixed(2)}, journal top ${kf.jt.toFixed(2)})`);
  await shot('F-stacked');
  for (const [fx, fz] of [[0.15, 0.85], [0.85, 0.85], [0.15, 0.15], [0.85, 0.15]]) {
    const jc = await scr(jbox[0] + (jbox[3] - jbox[0]) * fx, jbox[2] + (jbox[5] - jbox[2]) * fz, jbox[4]);
    await page.mouse.click(jc[0], jc[1]); await page.waitForTimeout(300);
    if (await E(() => /resting on/.test(document.querySelector('.olt-toast').textContent) || !!__olt.S.held)) break;
  }
  const heldJ = await E(() => ({ held: __olt.S.held && __olt.S.held.obj.def.id, toast: document.querySelector('.olt-toast').textContent }));
  ok(heldJ.held !== 'journal' && /resting on/.test(heldJ.toast), 'F  the journal cannot be pulled out from under the key: "' + heldJ.toast + '"');
  if (heldJ.held) await E(() => __olt.returnToTray());
  await page.click('.olt-reset'); await page.waitForTimeout(300);
  ok(await E(() => __olt.S.objs.every(o => o.state === 'tray')), 'J  EMPTY returns every piece to the shelf');
  await page.click('.olt-undo'); await page.waitForTimeout(300);
  ok(await E(() => __olt.S.objs.some(o => o.state === 'placed')), 'J  ...and undo puts them back');
  await page.click('.olt-menu-btn'); await page.waitForTimeout(300); await page.click('.olt-restart'); await page.waitForTimeout(500);
  const after = await E(() => ({ ids: __olt.S.objs.map(o => o.def.id).sort().join(','), tray: __olt.S.objs.every(o => o.state === 'tray'), undo: __olt.S.undo.length }));
  ok(after.ids === items && after.tray && after.undo === 0, 'J  restart restores the original collection on the shelf');
  // ---- K camera ----
  await page.waitForTimeout(600);
  const c0 = await E(() => __olt.view.camera.position.toArray());
  await shot('K-default');
  await drag(60, 300, 340, 260, 12);
  await page.waitForTimeout(700);
  const c1 = await E(() => __olt.view.camera.position.toArray());
  ok(Math.hypot(c1[0] - c0[0], c1[2] - c0[2]) > 3, 'K  dragging empty space orbits the camera ' + JSON.stringify([c0, c1, await E(() => [__olt.view.orbit.az, __olt.view.orbit.azT, !!__olt.S.held])]));
  await shot('K-orbit');
  const inside = await E(() => { const c = __olt.view.camera.position, d = __olt.S.dr; return c.y > d.H + 5; });
  ok(inside, 'K  camera stays above the drawer');
  // ---- L solvability ----
  const L1 = await E(() => { const r = []; for (let i = 0; i < __olt.Levels.count; i++) r.push(__olt.Packer.verify(__olt.Levels.designed(i)).ok); return r; });
  ok(L1.every(Boolean), 'L  all 12 designed drawers verified solvable in the browser');
  const t0 = Date.now();
  const L2 = await E(() => { const g = __olt.Levels.endlessGen(3); let r; do { r = g.next(); } while (!r.done); const pz = r.value; return pz && { ok: __olt.Packer.verify(pz).ok, n: pz.items.length, W: pz.W, D: pz.D, H: pz.H }; });
  ok(L2 && L2.ok, `L  endless drawer generated and verified in ${Date.now() - t0} ms (${L2 && L2.n} items, ${L2 && L2.W} x ${L2 && L2.D} x ${L2 && L2.H})`);
  console.log(logs.filter(l => /warn/i.test(l)).join('\n'));
  const errs = logs.filter(l => /error/i.test(l));
  ok(errs.length === 0, 'no console errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  console.log(fails ? fails + ' FAILED' : 'all acceptance scenarios passed');
  await close();
  process.exit(fails ? 1 : 0);
})();
