// ---- Explorer: a small traveller, ~4 heads tall, rust tunic, dark hair ------
// Painted with the same upper-left sun as the world: warm rim on the lit
// side, lavender-shifted shadow on the far side, and a contact shadow so the
// feet sit in the fur.

function drawExplorer(g, x, y, hp, facing, pose) {
  const E = PAL.explorer;
  const lean = pose === "climb" ? 0.1 : 0.03;
  g.save();
  g.translate(x, y);
  // Contact shadow (unflipped so it stays under the sun-far side).
  dab(g, -SUN_SIDE * hp * 0.05, -hp * 0.005, hp * 0.24, hp * 0.045, 0, PAL.fur[0], 0.45);
  g.scale(facing, 1);
  g.rotate(lean);
  const lit = SUN_SIDE * facing; // which local x side faces the sun
  const P = (pts, col, a) => {
    g.beginPath();
    g.moveTo(pts[0] * hp, -pts[1] * hp);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * hp, -pts[i + 1] * hp);
    g.closePath();
    g.fillStyle = css(col, a === undefined ? 1 : a);
    g.fill();
  };
  const limb = (x0, y0, x1, y1, x2, y2, w, col) => {
    g.beginPath();
    g.moveTo(x0 * hp, -y0 * hp);
    g.quadraticCurveTo(x1 * hp, -y1 * hp, x2 * hp, -y2 * hp);
    g.lineWidth = w * hp;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = css(col);
    g.stroke();
  };

  // Back leg and arm (in shadow).
  limb(-0.02, 0.42, -0.07, 0.22, -0.09, 0.06, 0.1, mixRGB(E.trousers, PAL.fur[0], 0.25));
  P([-0.15, 0.0, -0.04, 0.0, -0.04, 0.07, -0.13, 0.07], E.boots);
  limb(-0.06, 0.68, -0.12, 0.58, -0.1, 0.49, 0.075, E.tunicShade);
  dab(g, -0.1 * hp, -0.475 * hp, 0.035 * hp, 0.035 * hp, 0, mixRGB(E.skin, PAL.fur[0], 0.3), 1);

  // Front leg.
  limb(0.03, 0.42, 0.07, 0.24, 0.06, 0.06, 0.105, E.trousers);
  limb(0.0, 0.4, 0.04, 0.24, 0.035, 0.08, 0.035, E.trousersLit);
  P([0.0, 0.0, 0.14, 0.0, 0.14, 0.035, 0.11, 0.075, 0.02, 0.075], E.boots);

  // Tunic: A-line, belted, hem at mid-thigh.
  P([-0.12, 0.72, 0.11, 0.72, 0.14, 0.38, -0.15, 0.38], E.tunic);
  P(lit < 0 ? [-0.12, 0.72, -0.04, 0.72, -0.06, 0.38, -0.15, 0.38] : [0.04, 0.72, 0.11, 0.72, 0.14, 0.38, 0.06, 0.38], E.tunicLit, 0.85);
  P(lit < 0 ? [0.06, 0.72, 0.11, 0.72, 0.14, 0.38, 0.08, 0.38] : [-0.12, 0.72, -0.07, 0.72, -0.09, 0.38, -0.15, 0.38], E.tunicShade, 0.8);
  P([-0.135, 0.5, 0.125, 0.5, 0.127, 0.47, -0.138, 0.47], E.boots, 0.8);
  // Satchel strap and pouch: the traveller's only gear.
  limb(0.09, 0.71, 0.0, 0.6, -0.11, 0.48, 0.02, hex("#5b3f35"));
  P([-0.17, 0.5, -0.09, 0.5, -0.09, 0.41, -0.17, 0.41], hex("#6b4a3c"));

  // Head, face toward facing direction, tousled dark hair over the back.
  dab(g, 0.02 * hp, -0.84 * hp, 0.105 * hp, 0.115 * hp, 0, E.skin, 1);
  dab(g, 0.07 * hp, -0.83 * hp, 0.05 * hp, 0.07 * hp, 0, E.skinLit, 0.7);
  dab(g, -0.02 * hp, -0.75 * hp, 0.045 * hp, 0.03 * hp, 0, E.skin, 1); // neck
  const hair = [
    [-0.04, 0.9, 0.11, 0.1], [0.04, 0.95, 0.09, 0.06], [-0.08, 0.83, 0.07, 0.09],
    [0.08, 0.92, 0.06, 0.045], [-0.1, 0.92, 0.05, 0.06], [0.0, 0.98, 0.06, 0.04]
  ];
  for (const [hx, hy, rx, ry] of hair) dab(g, hx * hp, -hy * hp, rx * hp, ry * hp, 0.2, E.hair, 1);
  dab(g, (lit < 0 ? -0.08 : 0.03) * hp, -0.97 * hp, 0.05 * hp, 0.02 * hp, 0.3, E.hairLit, 0.8);

  // Front arm, relaxed with a slight swing.
  limb(0.05, 0.68, 0.12, 0.57, 0.11, 0.48, 0.078, E.tunic);
  limb(0.04, 0.69, 0.09, 0.6, 0.09, 0.52, 0.03, lit < 0 ? E.tunicShade : E.tunicLit);
  dab(g, 0.11 * hp, -0.465 * hp, 0.036 * hp, 0.036 * hp, 0, E.skin, 1);

  // Sun rim along the lit edge of head and back.
  g.globalAlpha = 0.55;
  dab(g, (lit < 0 ? -0.1 : 0.12) * hp, -0.86 * hp, 0.02 * hp, 0.07 * hp, 0, PAL.furRim, 1);
  dab(g, (lit < 0 ? -0.135 : 0.13) * hp, -0.58 * hp, 0.018 * hp, 0.12 * hp, 0, PAL.furRim, 1);
  g.restore();
}
