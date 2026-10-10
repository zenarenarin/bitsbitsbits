// ---- World: one sleeping creature laid across depth layers ------------------
// The creature lies diagonally up a slope, facing left, as in the reference
// title panel: tail low on the right, back rising up-left, shoulder, neck,
// and the head at the top with its muzzle to the left. The low sun sits on
// the right, so the climbing surface (the back) faces the light.
//
// play  (depth 1.0)  - the body the explorer climbs. Its upper-right face is
//                      the route: fur shelves on the back make the treads.
// flank (depth 0.55) - the creature's far flank and dorsal spires, behind.
// tail  (depth 0.2)  - the tail curling up out of the cloud sea.
// fore  (depth 1.5)  - near fur clumps that frame the bottom of the screen.
// Props (mushrooms, trees, the closed eye) are rooted on anatomy surfaces.

const EXPLORER_HEIGHT = 1.5;
const SUN_SIDE = 1; // +1: sun on the right

// Point on the dorsal (sun-facing, upper-right) surface of a spine sample.
function dorsalAt(samples, i) {
  const a = samples[Math.max(0, i - 1)], b = samples[Math.min(samples.length - 1, i + 1)];
  let tx = b[0] - a[0], ty = b[1] - a[1];
  const l = Math.hypot(tx, ty) || 1;
  tx /= l; ty /= l;
  const nx = ty, ny = -tx; // right-hand normal: up-right for a spine rising up-left
  const s = samples[i];
  return { x: s[0] + nx * s[2], y: s[1] + ny * s[2], nx, ny, tx, ty, r: s[2], cx: s[0], cy: s[1] };
}

function buildWorld(seed) {
  const rnd = rngFrom(seed);
  const R = (a, b) => a + (b - a) * rnd();

  // -- Play layer: the climbable body ---------------------------------------
  const play = new Anatomy("play");
  const spine = sampleSpine([
    [70, -80, 46], [46, -14, 40], [22, 34, 36], [-2, 78, 33], [-26, 116, 31],
    [-48, 154, 29], [-62, 192, 25], [-65, 224, 19], [-60, 250, 14], [-57, 270, 12.5]
  ], 8);
  addSpine(play, spine, { k: 8, hk: 6, hs: 0.5 });

  // Head, facing left: furred cranium, muzzle, cheek ruff, two ears.
  const HX = -58; // head sits over the neck, muzzle forward (left)
  // Forelimb stretched up-slope with the chin resting on it: upper arm along
  // the neck, forearm under the jaw, a broad paw with toe lobes.
  play.seg(-46, 206, 11, -42, 240, 8.5, { k: 5, hk: 4, hs: 0.5, base: 1 });
  play.seg(-42, 240, 8.5, -58, 260, 6.8, { k: 4, hk: 3, hs: 0.5, base: 2 });
  play.seg(-58, 260, 6.8, -72, 261, 6, { k: 3, hk: 3, hs: 0.5, base: 2.5 });
  play.ell(-79, 259.5, 6.5, 4.6, 0.05, { k: 2.5, hk: 2, hz: 3, base: 3 });
  for (const [tx, ty, ta] of [[-84.5, 257.5, 2.2], [-83, 262, 2.1], [-79.5, 264.2, 2]]) {
    play.ell(tx, ty, ta, ta * 0.72, 0.3, { k: 1, hk: 1, hz: 1.4, base: 5, tag: "lobe" });
  }
  play.ell(HX, 284, 14, 10.5, 0.12, { k: 6, hk: 4, hz: 9, base: 2, tag: "cranium" });
  play.ell(HX - 13.5, 279, 7.5, 5.5, 0.25, { k: 3.5, hk: 3, hz: 4, base: 6, tag: "muzzle" });
  play.ell(HX + 12, 274, 7, 8.5, -0.3, { k: 4, hk: 3, hz: 5, base: 4 });
  play.seg(HX - 3, 292, 3.4, HX - 5, 302, 2.0, { mat: MAT_EAR, k: 2, hk: 1.5, hs: 0.4, base: 1, tag: "ear-far" });
  play.seg(HX + 7, 290, 6.6, HX + 12.5, 309, 3.4, { mat: MAT_EAR, k: 2.4, hk: 1.5, hs: 0.6, base: 9, tag: "ear" });

  // Fur shelves on the back: drooping lobes whose flat-ish tops are the
  // treads of the climb, spaced by distance along the back so the route is a
  // staircase of rounded fur ledges. They belong to the body field, so every
  // shelf is painted fur and walkable ground at once.
  const dorsal = [];
  for (let i = 1; i < spine.length - 1; i++) dorsal.push(dorsalAt(spine, i));
  const shelves = [];
  let dist = 0, next = 2;
  for (let i = 1; i < dorsal.length; i++) {
    const p0 = dorsal[i - 1], p1 = dorsal[i];
    const segLen = Math.hypot(p1.x - p0.x, p1.y - p0.y);
    while (next <= dist + segLen) {
      const t = (next - dist) / segLen;
      const x = lerp(p0.x, p1.x, t), y = lerp(p0.y, p1.y, t);
      if (y > 262) break;
      const roll = rnd();
      const big = roll < 0.2, tiny = roll > 0.82;
      const a = big ? R(4.6, 6.6) : tiny ? R(1.6, 2.3) : R(2.3, 3.9);
      const b = a * R(0.32, 0.5);
      const cx = x + a * R(0.5, 0.8), cy = y - b * R(0.2, 0.6);
      play.ell(cx, cy, a, b, -R(0.0, 0.2), { k: R(0.5, 0.9), hk: 1.2, hz: b * 1.3, base: 0.8, tag: "shelf" });
      shelves.push({ x: cx, y: cy, a, b });
      if (big && rnd() < 0.6) {
        // A smaller lobe tucked beside a big one: ledges grow in clusters.
        const a2 = a * R(0.4, 0.6);
        play.ell(cx + a * R(0.5, 0.8), cy - b * R(0.5, 1.0), a2, a2 * R(0.35, 0.5), -R(0.05, 0.3), { k: 0.8, hk: 1.2, hz: a2 * 0.5, base: 0.8, tag: "shelf" });
      }
      next += (tiny ? R(2.2, 3) : R(3, 5.2)) + (big ? R(0.8, 2.2) : 0);
    }
    dist += segLen;
  }
  // Soft lobes along the belly side so the lower silhouette is never a tube.
  for (let i = 1; i < spine.length - 2; i += 1 + Math.floor(rnd() * 2)) {
    const s = spine[i];
    const d = dorsalAt(spine, i);
    const a = R(4, 8);
    play.ell(s[0] - d.nx * s[2], s[1] - d.ny * s[2], a, a * R(0.45, 0.6), R(0.05, 0.3), { k: 3, hk: 2, hz: a * 0.5, base: 0.4, tag: "lobe" });
  }

  // Interior fur masses on the flank facing the camera: big soft forms so the
  // body reads as rounded anatomy rather than a flat fill.
  for (let i = 0; i < spine.length; i++) {
    const d = dorsalAt(spine, i);
    if (d.cy > 205) break;
    const n = rnd() < 0.5 ? 1 : 0;
    for (let j = 0; j < n; j++) {
      const depth = R(4, d.r * 1.6);
      const x = d.x - d.nx * depth + d.tx * R(-3, 3), y = d.y - d.ny * depth + d.ty * R(-3, 3);
      const a = R(7, 13), b = a * R(0.5, 0.7), hz = R(1.6, 3);
      const base = reliefAt(play, x, y) - hz * 0.6;
      play.ell(x, y, a, b, Math.atan2(d.ty, d.tx) + R(-0.3, 0.3), { k: 0.5, hk: 5, hz, base });
    }
  }

  // Dorsal spires rising from the back (rose-cream monoliths) - landmarks on
  // the route, like the reference BACK panel. Placed by height on the back.
  const backAt = (y) => {
    let best = dorsal[0];
    for (const d of dorsal) if (Math.abs(d.y - y) < Math.abs(best.y - y)) best = d;
    return best;
  };
  for (const [y, len, lean, ra] of [[140, 15, -0.12, 2.6], [176, 21, 0.06, 3.4], [206, 13, -0.2, 2.2], [92, 12, 0.1, 2.2]]) {
    const d = backAt(y);
    const ax = d.x - d.nx * 2.2, ay = d.y - d.ny * 2.2;
    const bx = ax + Math.sin(lean) * len, by = ay + Math.cos(lean) * len;
    const base = reliefAt(play, ax, ay) + 1.5;
    play.seg(ax, ay, ra, bx, by, ra * 0.5, { mat: MAT_SPIRE, k: 1.0, hk: 1.2, hs: 0.7, base });
  }

  // -- Props rooted on the body ---------------------------------------------
  const props = { mushrooms: [], trees: [], eyes: [] };
  props.eyes.push({ x: HX - 5.5, y: 284.5, w: 5.8, tilt: 0.1, outer: 1 });

  function addMushroom(x, yHint, capR, stemH, lean) {
    const y = play.surfaceBelow(x, yHint + 10, yHint - 14);
    if (y === null) return false;
    const root = { x, y: y - 0.3 };
    const top = { x: x + lean, y: y + stemH };
    play.seg(root.x, root.y, 0.32 + capR * 0.05, top.x, top.y, 0.24 + capR * 0.04, { mat: MAT_SHROOM, k: 0, hk: 0.01, base: 30 });
    play.ell(top.x, top.y + capR * 0.12, capR, capR * 0.32, 0, { mat: MAT_SHROOM, k: 0, hk: 0.01, hz: 1, base: 31 });
    props.mushrooms.push({ root, top, capR });
    return true;
  }
  function addTree(x, yHint, h, kind) {
    const y = play.surfaceBelow(x, yHint + 10, yHint - 14);
    if (y !== null) props.trees.push({ x, y, h, kind, seed: hash2(x * 10, y * 10, seed) });
  }

  // A standing spot on top of a shelf (searches across the tread).
  function standOn(s) {
    for (const f of [0.2, 0.35, 0.05, 0.5, 0.65, 0.8]) {
      const x = s.x + s.a * f;
      const y = play.surfaceBelow(x, s.y + s.b + 7, s.y - s.b - 3);
      if (y !== null && y > s.y - s.b * 0.5) return { x, y };
    }
    return null;
  }
  const nearestShelf = (y, ok) => {
    let best = null;
    for (const s of shelves) if ((!best || Math.abs(s.y - y) < Math.abs(best.y - y)) && (!ok || ok(s))) best = s;
    return best;
  };

  // The gameplay showcase: the shelf on the back nearest 124 m.
  const show = nearestShelf(124, (s) => standOn(s));
  const { x: gx, y: gy } = standOn(show);
  addTree(gx + 2.2, gy + 1, 2.6, "cypress");
  addTree(gx - 2.8, gy + 7, 3.4, "cypress");
  addTree(gx + 4, gy - 4, 1.6, "shrub");
  // Sparse vegetation along the rest of the back.
  for (const s of shelves) {
    if (Math.abs(s.y - gy) > 14 && rnd() < 0.35) addTree(s.x + R(-s.a * 0.2, s.a * 0.5), s.y + s.b + 4, R(1.2, 3.2), rnd() < 0.5 ? "shrub" : "cypress");
  }
  addMushroom(gx - 4.2, gy + 6, 1.9, 2.4, -0.4);
  addMushroom(gx + 5.5, gy - 7, 1.4, 1.6, 0.3);
  addMushroom(gx - 7.8, gy + 9, 1.1, 1.3, -0.2);

  // Establishing: on a shelf of the neck, below and behind the head.
  // Establishing: standing on the brow, right above the closed eye (the
  // reference's summit panel) - a spot the climb really reaches.
  const ex = HX - 11;
  const ey = play.surfaceBelow(ex, 310, 270);
  if (ey === null) throw new Error("brow has no standing surface");
  const explorerSpots = {
    gameplay: { x: gx, y: gy, facing: -1 },
    establishing: { x: ex, y: ey, facing: -1 }
  };
  const focus = { head: { x: HX - 4, y: 285 } };

  // -- Flank layer: far side of the back curving away, behind mist ----------
  // A low, broad rolling form (not a second pillar) carrying a few spires.
  const flank = new Anatomy("flank");
  const flankSpine = sampleSpine([
    [130, -100, 46], [100, -20, 40], [70, 48, 34], [48, 88, 26], [38, 108, 16]
  ], 5);
  addSpine(flank, flankSpine, { k: 9, hk: 6, hs: 0.45 });
  for (let i = 1; i < flankSpine.length - 1; i++) {
    const d = dorsalAt(flankSpine, i);
    const a = R(5, 10);
    flank.ell(d.x + a * 0.15, d.y - a * 0.1, a, a * R(0.4, 0.5), -R(0.05, 0.2), { k: 2.5, hk: 2, hz: a * 0.5, base: 0.6 });
  }
  for (const [i, len, lean] of [[8, 26, 0.12], [12, 20, -0.05], [15, 15, 0.2]]) {
    const d = dorsalAt(flankSpine, Math.min(i, flankSpine.length - 2));
    const ax = d.x - d.nx * 3, ay = d.y - d.ny * 3;
    flank.seg(ax, ay, R(3.6, 4.8), ax + Math.sin(lean) * len, ay + Math.cos(lean) * len, R(1.6, 2.4),
      { mat: MAT_SPIRE, k: 1.5, hk: 1.5, hs: 0.7, base: reliefAt(flank, ax, ay) + 2 });
  }

  // -- Tail layer: the tail curling up out of the clouds ---------------------
  const tail = new Anatomy("tail");
  const tailSpine = sampleSpine([
    [70, -60, 15], [74, 30, 13], [68, 100, 11], [52, 142, 9], [30, 154, 7],
    [18, 144, 5.5], [21, 128, 4], [31, 126, 3]
  ], 6);
  addSpine(tail, tailSpine, { k: 4, hk: 3, hs: 0.5 });

  // -- Foreground: near fur clumps framing the bottom of the frame -----------
  const fore = new Anatomy("fore");
  const gs = explorerSpots.gameplay;
  fore.ell(gs.x - 3.6, gs.y - 5.4, 2.2, 1.5, 0.3, { k: 1, hk: 1, hz: 1.5, tag: "lobe" });
  fore.ell(gs.x - 1.4, gs.y - 5.9, 2.0, 1.4, -0.15, { k: 1, hk: 1, hz: 1.4, tag: "lobe" });
  fore.ell(gs.x + 4.4, gs.y - 5.6, 2.2, 1.3, -0.3, { k: 1, hk: 1, hz: 1.3, tag: "lobe" });

  return {
    seed,
    spine,
    layers: { play, flank, tail, fore },
    props,
    explorerSpots,
    focus
  };
}
