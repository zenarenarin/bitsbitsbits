// =====================================================================
// THE WATCHER'S STREET: the authored slice.
//
// Everything the player can stand on, hang from, climb or hide behind is
// declared here, and the same geometry blocks the Watcher's light. The
// façades behind the street are scenery only; they are drawn from the
// `facades` list and never collide.
//
// Kinds of thing:
//   solids   - boxes you collide with on every side (chimneys, the gate
//              block, crates, the cellar walls). They block light.
//   plats    - one-way slabs (balconies, roof edges, cornices). You land
//              on them from above, jump up through them, hang from their
//              front lip and shimmy along it. They block light.
//   pipes    - drainpipes you climb.
//   ropes    - a pulley rope you swing on.
//   awnings  - the signature mechanic: a cord folds an awning out; while
//              out it is a platform and it throws a shadow.
//   shutters - rolling iron shutters the Watcher lowers when it hunts.
//   recesses - doorways: stand in one and the light cannot reach you.
//   sheets   - laundry that sways and blocks light.
//   lights   - the Watcher's lamps.
// =====================================================================
function buildLevel() {
  const L = {
    solids: [], plats: [], pipes: [], ropes: [], awnings: [], shutters: [], recesses: [],
    sheets: [], lights: [], checkpoints: [], sections: [], facades: [], props: [], windows: [],
    x0: 0, x1: 150, exitX: 143.5, start: { x: 1.4, y: 9 }
  };
  const solid = (x0, y0, x1, y1, o) => { const s = Object.assign({ x0, y0, x1, y1, kind: 'block', grab: true, occ: true }, o); L.solids.push(s); return s; };
  const plat = (x0, x1, y, o) => { const p = Object.assign({ x0, x1, y, th: 0.32, kind: 'balcony', grab: true, occ: true }, o); L.plats.push(p); return p; };
  const pipe = (x, y0, y1, o) => { const p = Object.assign({ x, y0, y1 }, o); L.pipes.push(p); return p; };
  const facade = (x0, x1, h, style, o) => { const f = Object.assign({ x0, x1, h, style, seed: Math.round(x0 * 97 + h * 13) }, o); L.facades.push(f); return f; };
  const light = o => { const l = Object.assign({ half: deg(8), amp: 0, period: 6, phase: 0, range: 44, maxDev: deg(40), kind: 'tower', huntOnly: false, hold: 0 }, o); l.base = deg(o.base); l.amp = deg(o.amp || 0); if (o.half) l.half = deg(o.half); if (o.maxDev) l.maxDev = deg(o.maxDev); L.lights.push(l); return l; };
  const section = (x, name, num) => L.sections.push({ x, name, num });
  const checkpoint = (x, y, face) => L.checkpoints.push({ x, y, face: face || 1 });
  const recess = (x0, x1, h, y0) => { y0 = y0 || 0; const r = { x0, x1, y0, y1: y0 + (h || 2.3), open: 0 }; L.recesses.push(r); return r; };

  // the street, and the city's left edge
  solid(-12, -4, 160, 0, { kind: 'street', grab: false });
  solid(-12, 0, 0, 40, { kind: 'edge', grab: false, occ: false });
  solid(150, 0, 162, 40, { kind: 'edge', grab: false, occ: false });

  // ---------------------------------------------------------------
  // I. THE BALCONY. You begin in a balcony doorway. A searchlight on the
  // tower across the street sweeps the balcony and the street below; the
  // far balcony, under the overhanging roof, is in its shadow. Watch the
  // sweep, then run and jump while it is away. The cornice above is the
  // way on. Dropping to the street is loud, and the street is lit too.
  // ---------------------------------------------------------------
  section(0, 'The balcony', 'I');
  facade(-6, 12.4, 16.5, 'gable');
  plat(0.2, 7.2, 9, { rail: true });
  plat(8.8, 13.8, 9, { rail: true });
  recess(0.6, 2.2, 2.3, 9);
  pipe(8.0, 0, 9);
  plat(1.2, 5.2, 4.6, { rail: true });
  light({ x: 19.2, y: 21.5, base: 222, amp: 14, period: 5.2, phase: -1.2, half: 7.5, range: 34, kind: 'tower', maxDev: 30 });
  checkpoint(1.4, 9);

  // ---------------------------------------------------------------
  // II. FIRST CONTACT. Three ways along the terrace:
  //  - the roof: a lamp on the tall house ahead rakes it; chimneys throw
  //    long shadows. Fast, but you cross in rhythm.
  //  - under the roof's edge: hang and shimmy. Safe, but slow.
  //  - the street: two lanterns sweep it; dart between doorways.
  // ---------------------------------------------------------------
  section(13, 'First contact', 'II');
  facade(12.4, 20.2, 11.6, 'terrace');
  facade(20.2, 44.2, 11.6, 'long');
  plat(12.6, 44.2, 11.6, { kind: 'roof', th: 0.6, shimmy: true });
  solid(21.6, 11.6, 22.8, 13.8, { kind: 'chimney' });
  solid(28.0, 11.6, 29.4, 14.2, { kind: 'chimney' });
  solid(34.6, 11.6, 35.8, 13.6, { kind: 'chimney' });
  solid(40.0, 11.6, 40.9, 12.55, { kind: 'chimney', stub: true });
  light({ x: 47.4, y: 16.4, base: 197, amp: 10, period: 6.4, half: 7, range: 46, kind: 'bracket', maxDev: 30 });
  // the street beneath the terrace
  light({ x: 25.0, y: 6.9, base: 270, amp: 30, period: 4.6, half: 20, range: 9.5, kind: 'lantern', maxDev: 50 });
  light({ x: 36.0, y: 6.9, base: 270, amp: 30, period: 4.6, phase: Math.PI * 0.8, half: 20, range: 9.5, kind: 'lantern', maxDev: 50 });
  recess(19.4, 20.8);
  recess(29.8, 31.2);
  recess(41.0, 42.4);

  // ---------------------------------------------------------------
  // III. DESCENT. Under the lamp is the one place it cannot look. A
  // drainpipe runs down the tall house to the street; two balconies
  // offer a quicker way down.
  // ---------------------------------------------------------------
  section(44.2, 'Descent', 'III');
  facade(44.4, 60, 21, 'tall');
  pipe(44.9, 0, 11.6);
  plat(45.6, 49.2, 7.8, { rail: true });
  plat(45.6, 48.6, 4.2, { rail: true });
  checkpoint(46.6, 0);

  // ---------------------------------------------------------------
  // IV. THE AWNING. A lantern hangs over the street and swings its gaze
  // across it. The cord hangs in the open at the edge of its sweep: pull
  // while the lantern looks away. The awning unrolls under the lantern and
  // its shadow covers the cord and the crossing for a few seconds. The
  // pull is loud: the lantern turns to where you pulled it.
  // The high road (balconies) is exposed to a raking lamp instead.
  // ---------------------------------------------------------------
  section(50, 'The awning', 'IV');
  facade(60, 70, 14, 'shop');
  recess(52.6, 54.0, 2.4);
  const aw1 = { ax: 56.9, ay: 3.2, len: 6.6, dir: 1, cord: { x: 56.2, y: 0 }, holdS: 4.5 };
  L.awnings.push(aw1);
  L.props.push({ kind: 'pilaster', x: 56.85, top: 3.2 });
  light({ x: 60.4, y: 7.4, base: 270, amp: 18, period: 7.5, half: 30, range: 14, kind: 'lantern', maxDev: 55 });
  // the high road
  plat(51.6, 55.2, 8.4, { rail: true });
  recess(51.8, 53.2, 2.3, 8.4);
  plat(58.6, 63.4, 8.4, { rail: true, hook: 60.4 });
  plat(66.4, 70.4, 8.4, { rail: true });
  light({ x: 74.6, y: 13.2, base: 189, amp: 13, period: 5.6, phase: 1.3, half: 4, range: 24, kind: 'bracket', maxDev: 30 });
  pipe(70.0, 0, 8.4);
  recess(64.8, 66.2, 2.4);

  // ---------------------------------------------------------------
  // V. THE WATCHER RESPONDS. A gate passage with an iron shutter. When
  // the Watcher hunts or investigates nearby, the shutter comes down.
  // Slide under it, wait in a doorway until it lifts, or climb over the
  // gatehouse where another lamp sweeps.
  // ---------------------------------------------------------------
  section(71, 'The Watcher responds', 'V');
  facade(70, 80, 13, 'narrow');
  recess(74.2, 75.6, 2.4);
  solid(80, 2.7, 88, 11.8, { kind: 'gate', grabTop: true });
  L.shutters.push({ x0: 80.0, x1: 80.35, top: 2.7, y: 2.7, open: 2.7, reach: 36, delay: 0.5, speed: 0.48, lift: 1.1, wait: 0 });
  pipe(79.4, 0, 11.8);
  light({ x: 92.2, y: 17.6, base: 200, amp: 9, period: 5.6, phase: 2.0, half: 7, range: 21, kind: 'tower', maxDev: 34 });
  checkpoint(72.6, 0);

  // ---------------------------------------------------------------
  // VI. THE ESCAPE. A laundry court over an open cellar. Two lamps sweep
  // the court out of step; the sheets throw moving shade. Swing across on
  // the pulley rope, or drop into the cellar and climb out.
  // ---------------------------------------------------------------
  section(88.5, 'The escape', 'VI');
  facade(88, 96, 16, 'tall');
  facade(96, 110, 10, 'court');
  // cellar: cut the street between 99 and 106
  L.solids[0].x1 = 99;
  solid(106, -4, 160, 0, { kind: 'street', grab: false });
  solid(99, -4, 106, -3, { kind: 'cellar', grab: false });
  pipe(105.6, -3, 0);
  pipe(99.4, -3, 0);
  L.ropes.push({ ax: 102.6, ay: 9.2, len: 6.4 });
  for (let i = 0; i < 4; i++) L.sheets.push({ x: 100.2 + i * 2.4, y: 7.6, w: 1.1, h: 1.6 + (i % 2) * 0.4, phase: i * 1.7 });
  light({ x: 90.8, y: 15.4, base: 318, amp: 14, period: 6.2, half: 9, range: 30, kind: 'bracket', maxDev: 40 });
  light({ x: 115.6, y: 15.0, base: 224, amp: 14, period: 6.2, phase: Math.PI, half: 9, range: 30, kind: 'bracket', maxDev: 40 });
  recess(110.9, 112.4, 2.4);

  // ---------------------------------------------------------------
  // VII. THE LAST LIGHT. The street's last lamp stands on a post over the
  // final crossing. A second awning hangs above it, but its cord is up on
  // the balcony, in the path of a sweeping lamp. Pull it and drop, or
  // take the rooftops and time the sweep.
  // ---------------------------------------------------------------
  section(110, 'The last light', 'VII');
  facade(110, 120, 17, 'gable');
  facade(120, 134, 13, 'shop');
  facade(134, 142.6, 15, 'narrow');
  facade(142.6, 152, 14, 'gate');
  pipe(122.4, 0, 6.4);
  plat(121.8, 126.6, 6.4, { rail: true });
  const aw2 = { ax: 127.2, ay: 3.0, len: 8.2, dir: 1, cord: { x: 125.8, y: 6.4 }, holdS: 5.0 };
  L.awnings.push(aw2);
  L.props.push({ kind: 'pilaster', x: 127.15, top: 3.0 });
  light({ x: 131.0, y: 6.6, base: 270, amp: 0, half: 40, range: 11, kind: 'post' });
  light({ x: 118.4, y: 16.6, base: 302, amp: 9, period: 4.8, half: 5, range: 28, kind: 'tower', maxDev: 40 });
  plat(128.6, 141.6, 13, { kind: 'roof', th: 0.6 });
  pipe(127.9, 6.4, 13);
  light({ x: 146.4, y: 18.4, base: 190, amp: 5, period: 4.4, phase: 0.5, half: 5, range: 26, kind: 'tower', maxDev: 30 });
  recess(136.2, 137.6, 2.4);
  checkpoint(119.6, 0);
  L.props.push({ kind: 'lamppost', x: 131.0, y: 0, top: 6.6 });
  L.props.push({ kind: 'arch', x: 143.0 });

  // Every light remembers which sector it guards, for the Watcher's choice
  // of which lamps join a search.
  L.lights.forEach((l, i) => { l.id = i; l.ang = l.base; l.clock = l.phase * l.period / TAU; });
  L.sections.forEach((s, i) => { s.i = i; s.x1 = i + 1 < L.sections.length ? L.sections[i + 1].x : L.x1; });
  return L;
}
