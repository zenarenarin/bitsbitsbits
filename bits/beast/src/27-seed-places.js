// ---- Dream Seed placement ----------------------------------------------------
// Common seeds grow on the treads of the climb, so the main route passes over
// them. Rare lantern seeds crown mushroom caps grown out over the drop beside
// the route: a jump - and so a noise - away. Ancient fronds sit at the end of
// two-cap chains, reachable only from the first cap. Placement has its own random
// stream, so adding seeds never changes the rest of the world.

const SEED_KINDS = {
  common: { value: 1, h: 0.8 },
  rare: { value: 3, h: 1.0 },
  ancient: { value: 7, h: 1.15 }
};

function placeDreamSeeds(play, shelves, props, addMushroom, standOn, nearestShelf, seed) {
  const rnd = rngFrom(seed + 77);
  const R = (a, b) => a + (b - a) * rnd();
  const seeds = [];
  const add = (kind, x, y, extra) => {
    seeds.push(Object.assign({ id: seeds.length, kind, x, y, value: SEED_KINDS[kind].value, phase: rnd() * 6.28, lean: R(-0.2, 0.2) }, extra));
  };
  const clear = (x, y, d) =>
    !props.trees.some((t) => Math.abs(t.x - x) < d && Math.abs(t.y - y) < 1.5) &&
    !props.mushrooms.some((m) => Math.abs(m.root.x - x) < d && Math.abs(m.root.y - y) < 1.5) &&
    !seeds.some((s) => Math.abs(s.x - x) < d * 2 && Math.abs(s.y - y) < 2);
  const normalY = (x, y) => {
    const e = 0.05;
    const gx = play.sdAt(x + e, y) - play.sdAt(x - e, y), gy = play.sdAt(x, y + e) - play.sdAt(x, y - e);
    return gy / (Math.hypot(gx, gy) || 1);
  };
  const ground = (x, yHint) => play.surfaceBelow(x, yHint + 8, yHint - 10);

  // Common: every few treads from just above the cloud sea to the neck.
  let gap = 1;
  for (const s of shelves) {
    if (s.y < 4 || --gap > 0) continue;
    for (const f of [R(0.05, 0.6), 0.25, 0.45, 0.65]) {
      const x = s.x + s.a * f;
      const y = ground(x, s.y + s.b);
      if (y === null || y < s.y - s.b * 0.5 || normalY(x, y + 0.02) < 0.72 || !clear(x, y, 0.9)) continue;
      add("common", x, y);
      gap = 1 + Math.floor(rnd() * 3);
      break;
    }
  }

  // A cap grown out over the drop at the downhill end of a tread, its top
  // `rise` metres above the fur 2 m uphill (the back rises to the left),
  // where the explorer takes off to reach it.
  const capBeside = (s, rise, out, capR) => {
    if (!s) return null;
    const x = s.x + s.a * out;
    const y = ground(x, s.y);
    const from = ground(x - 2, s.y + 2);
    if (y === null || from === null) return null;
    const stemH = clamp(from + rise - y - capR * 0.44, 0.9, 7);
    if (!addMushroom(x, s.y, capR, stemH, R(0.2, 0.45))) return null;
    return props.mushrooms[props.mushrooms.length - 1];
  };
  const onCap = (kind, m) => add(kind, m.cap.x, m.cap.y + m.cap.b, { cap: props.mushrooms.indexOf(m) });

  // Rare: lantern seeds on single caps beside the route.
  for (const y of [28, 52, 76, 100, 150, 192, 214]) {
    const m = capBeside(nearestShelf(y, (s) => standOn(s)), R(1.3, 1.6), R(0.95, 1.15), R(1.3, 1.6));
    if (m) onCap("rare", m);
  }
  // The tallest cap by the starting grove carries one too.
  const grove = props.mushrooms.slice(0, 4).sort((a, b) => b.cap.y - a.cap.y)[0];
  if (grove) onCap("rare", grove);

  // Ancient: two-cap chains out over the drop - the second cap only from the first.
  for (const y of [112, 170, 232]) {
    const s = nearestShelf(y, (q) => standOn(q));
    const a = capBeside(s, 1.2, 1.0, 1.5);
    if (!a) continue;
    const bx = a.cap.x + 2.3;
    const by = ground(bx, a.root.y);
    if (by === null) continue;
    const capR = 1.4;
    const stemH = a.cap.y + a.cap.b + 1.45 - by - capR * 0.44;
    if (addMushroom(bx, a.root.y, capR, stemH, 0.3)) onCap("ancient", props.mushrooms[props.mushrooms.length - 1]);
  }
  return seeds;
}
