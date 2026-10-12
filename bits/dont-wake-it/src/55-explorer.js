// ---- Explorer figure: a small traveller, ~4 heads tall, posed by state ------
// A light skeleton (hip, neck, two-bone legs and arms) drives the painted
// shapes: idle breathing, careful walk, faster pace with forward lean, jump
// anticipation crouch, airborne tuck, landing squash and bracing. Lit by the
// same low sun as the world, with a contact shadow so the feet sit in the fur.
// Coordinates: units of the figure height, origin at the feet, y up.

function ik2(h, f, l1, l2, bend) {
  const dx = f[0] - h[0], dy = f[1] - h[1];
  const d = clamp(Math.hypot(dx, dy), 1e-4, l1 + l2 - 1e-4);
  const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const hh = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d, uy = dy / d;
  return [h[0] + ux * a - uy * hh * bend, h[1] + uy * a + ux * hh * bend];
}

function drawExplorer(g, x, y, hp, facing, pose) {
  pose = pose || {};
  const E = PAL.explorer;
  const crouch = pose.crouch || 0, air = pose.air || 0, run = pose.run || 0, move = pose.move || 0;
  const ph = pose.phase || 0, t = pose.time || 0;
  const breathe = Math.sin(t * 2.1) * 0.007 * (1 - move) * (1 - air);
  const lit = SUN_SIDE * facing;

  g.save();
  g.translate(x, y);
  dab(g, -SUN_SIDE * hp * 0.05, -hp * 0.005, hp * 0.24 * (1 - air * 0.5), hp * 0.045 * (1 - air * 0.5), 0, PAL.fur[0], 0.45 * (1 - air * 0.75));
  g.scale(facing, 1);
  // Lean into the slope a little when walking uphill/downhill.
  g.rotate(-(pose.slope || 0) * 0.25 * facing);

  const P = (pts) => pts.map(([px, py]) => [px * hp, -py * hp]);
  const limb = (pts, w, col) => {
    const q = P(pts);
    g.beginPath();
    g.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) g.lineTo(q[i][0], q[i][1]);
    g.lineWidth = w * hp;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = css(col);
    g.stroke();
  };
  const poly = (pts, col, a) => {
    const q = P(pts);
    g.beginPath();
    g.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) g.lineTo(q[i][0], q[i][1]);
    g.closePath();
    g.fillStyle = css(col, a === undefined ? 1 : a);
    g.fill();
  };

  // Skeleton.
  const stride = 0.12 + run * 0.1;
  const bob = move * Math.abs(Math.sin(ph)) * (0.012 + run * 0.02);
  const hipY = 0.46 - crouch * 0.13 + bob + breathe - air * 0.02;
  const lean = 0.04 + run * 0.14 + move * 0.03 + (pose.brace ? 0.1 : 0) - crouch * 0.05 + air * (pose.rising ? 0.02 : -0.04);
  const hip = [0, hipY];
  const neck = [lean * 0.3, hipY + 0.29 - crouch * 0.03];
  const head = [neck[0] + 0.035 + lean * 0.12, neck[1] + 0.13];

  let feet;
  if (air) {
    feet = pose.rising ? [[0.1, hipY - 0.27], [-0.07, hipY - 0.38]] : [[0.07, hipY - 0.4], [-0.05, hipY - 0.42]];
  } else {
    feet = [0, 1].map((i) => {
      const a = ph + i * Math.PI;
      return [Math.sin(a) * stride * move + (i ? -0.035 : 0.04), Math.max(0, Math.cos(a)) * (0.045 + run * 0.06) * move];
    });
    if (crouch) feet = feet.map(([fx, fy]) => [fx + (fx >= 0 ? 0.05 : -0.05) * crouch, fy * (1 - crouch)]);
  }
  const knees = feet.map((f) => ik2(hip, f, 0.245, 0.235, 1));
  const shoulder = [neck[0] - 0.01, neck[1] - 0.03];
  const hands = [0, 1].map((i) => {
    if (air) return pose.rising ? [shoulder[0] + (i ? -0.12 : 0.16), shoulder[1] + 0.08] : [shoulder[0] + (i ? -0.16 : 0.14), shoulder[1] - 0.06];
    if (pose.brace) return [shoulder[0] + 0.18, shoulder[1] - 0.12 + i * 0.05];
    const swing = Math.sin(ph + (i ? 0 : Math.PI)) * (0.07 + run * 0.08) * move;
    return [shoulder[0] + swing - crouch * 0.08 + (i ? -0.02 : 0.03), shoulder[1] - 0.25 + crouch * 0.05 + Math.abs(swing) * 0.2];
  });
  const elbows = hands.map((h) => ik2(shoulder, h, 0.135, 0.13, -1));

  const backCol = (c) => mixRGB(c, PAL.fur[0], 0.28);
  // Back leg and arm (the far side, in shadow).
  limb([hip, knees[1], feet[1]], 0.1, backCol(E.trousers));
  limb([[feet[1][0] - 0.02, feet[1][1] + 0.025], [feet[1][0] + 0.07, feet[1][1] + 0.02]], 0.06, E.boots);
  limb([shoulder, elbows[1], hands[1]], 0.075, E.tunicShade);
  dab(g, hands[1][0] * hp, -hands[1][1] * hp, 0.034 * hp, 0.034 * hp, 0, backCol(E.skin), 1);

  // Front leg.
  limb([hip, knees[0], feet[0]], 0.105, E.trousers);
  limb([[hip[0] - 0.01, hip[1] - 0.02], [knees[0][0] - 0.012, knees[0][1]], [feet[0][0] - 0.012, feet[0][1] + 0.04]], 0.03, E.trousersLit);
  limb([[feet[0][0] - 0.02, feet[0][1] + 0.025], [feet[0][0] + 0.075, feet[0][1] + 0.02]], 0.065, E.boots);

  // Tunic: A-line from the shoulders to mid-thigh, following the torso lean.
  const ax = neck[0] - hip[0], ay = neck[1] - hip[1], al = Math.hypot(ax, ay);
  const ux = ax / al, uy = ay / al, px = uy, py = -ux;
  const at = (s, w) => [hip[0] + ux * s + px * w, hip[1] + uy * s + py * w];
  const top = al + 0.01, hem = -0.08;
  poly([at(top, -0.115), at(top, 0.11), at(hem, 0.14), at(hem, -0.15)], E.tunic);
  poly(lit < 0 ? [at(top, -0.115), at(top, -0.04), at(hem, -0.06), at(hem, -0.15)] : [at(top, 0.04), at(top, 0.11), at(hem, 0.14), at(hem, 0.06)], E.tunicLit, 0.85);
  poly(lit < 0 ? [at(top, 0.06), at(top, 0.11), at(hem, 0.14), at(hem, 0.08)] : [at(top, -0.115), at(top, -0.07), at(hem, -0.09), at(hem, -0.15)], E.tunicShade, 0.8);
  poly([at(0.05, -0.135), at(0.05, 0.125), at(0.02, 0.127), at(0.02, -0.138)], E.boots, 0.8);
  limb([at(top - 0.01, 0.09), at(0.12, -0.02), at(0.02, -0.12)], 0.02, hex("#5b3f35"));
  poly([at(0.04, -0.17), at(0.04, -0.09), at(-0.05, -0.09), at(-0.05, -0.17)], hex("#6b4a3c"));

  // Head, face toward the facing direction, tousled dark hair.
  const [hx, hy] = head;
  dab(g, (hx - 0.035) * hp, -(hy - 0.09) * hp, 0.045 * hp, 0.03 * hp, 0, E.skin, 1);
  dab(g, hx * hp, -hy * hp, 0.105 * hp, 0.115 * hp, 0, E.skin, 1);
  dab(g, (hx + 0.05) * hp, -(hy + 0.01) * hp, 0.05 * hp, 0.07 * hp, 0, E.skinLit, 0.7);
  for (const [ox, oy, rx, ry] of [[-0.06, 0.06, 0.11, 0.1], [0.02, 0.11, 0.09, 0.06], [-0.1, -0.01, 0.07, 0.09], [0.06, 0.08, 0.06, 0.045], [-0.12, 0.08, 0.05, 0.06], [-0.02, 0.14, 0.06, 0.04]]) {
    dab(g, (hx + ox) * hp, -(hy + oy) * hp, rx * hp, ry * hp, 0.2, E.hair, 1);
  }
  dab(g, (hx + (lit < 0 ? -0.1 : 0.01)) * hp, -(hy + 0.13) * hp, 0.05 * hp, 0.02 * hp, 0.3, E.hairLit, 0.8);

  // Front arm.
  limb([shoulder, elbows[0], hands[0]], 0.078, E.tunic);
  limb([[shoulder[0] + 0.01, shoulder[1]], [elbows[0][0] + 0.01, elbows[0][1]]], 0.028, lit < 0 ? E.tunicShade : E.tunicLit);
  dab(g, hands[0][0] * hp, -hands[0][1] * hp, 0.036 * hp, 0.036 * hp, 0, E.skin, 1);

  // Sun rim along the lit edge of head and back.
  g.globalAlpha = 0.55;
  dab(g, (hx + (lit < 0 ? -0.12 : 0.1)) * hp, -hy * hp, 0.02 * hp, 0.07 * hp, 0, PAL.furRim, 1);
  const rim = at(al * 0.5, lit < 0 ? -0.13 : 0.12);
  dab(g, rim[0] * hp, -rim[1] * hp, 0.018 * hp, 0.12 * hp, 0, PAL.furRim, 1);
  g.restore();
}
