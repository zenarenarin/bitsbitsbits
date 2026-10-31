// Painted scene pieces: sprites for every object, the table, its stand and
// ballast, the stage floor, and the backdrop.

// Paint a world-space drawing into a sprite. `box` is [x0, y0, x1, y1] in
// world units (y up); R is pixels per unit.
function renderSprite(box, R, pad, seed, paint) {
  const w = (box[2] - box[0] + pad * 2) * R, h = (box[3] - box[1] + pad * 2) * R;
  const c = makeBuffer(w, h);
  const g = c.getContext('2d');
  const ox = (pad - box[0]) * R, oy = (pad + box[3]) * R;
  g.translate(ox, oy);
  g.scale(R, -R);
  const rnd = mulberry(seed);
  const B = makeBrush(g, rnd, R);
  paint(B, g);
  return { canvas: c, ox, oy, R };
}

function drawSprite(g, spr, x, y, angle, scale, alpha) {
  const k = scale / spr.R;
  g.save();
  g.translate(x, y);
  if (angle) g.rotate(-angle);
  g.scale(k, k);
  if (alpha != null) g.globalAlpha = alpha;
  g.drawImage(spr.canvas, -spr.ox, -spr.oy);
  g.restore();
}

function paintObjectSprite(def, R) {
  return renderSprite(def.box, R, 0.03, hashStr(def.id), B => {
    // a soft painted contact shadow under the base
    B.g.save();
    B.g.fillStyle = rgba(PAL.ink, 0.22);
    B.g.beginPath();
    const w = (def.box[2] - def.box[0]) * 0.42;
    B.g.ellipse((def.box[0] + def.box[2]) / 2, 0.004, w, 0.018, 0, 0, TAU);
    B.g.fill();
    B.g.restore();
    def.paint.call(def, B);
  });
}

// A silhouette of the object for selection halos and lift shadows.
function silhouetteSprite(spr, color) {
  const c = makeBuffer(spr.canvas.width, spr.canvas.height);
  const g = c.getContext('2d');
  g.drawImage(spr.canvas, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return { canvas: c, ox: spr.ox, oy: spr.oy, R: spr.R };
}

// ---- Table ----
// Body-local coordinates (origin at the pivot). The collision plank is
// 4 x 0.16 with its top at y = 0.22. The painting adds a sliver of the top
// plane seen from slightly above, so objects stand *on* the table.
function paintTable(R) {
  const P = PHYS;
  const L = P.halfLen, top = P.topY;
  return renderSprite([-L - 0.08, -0.12, L + 0.08, top + 0.1], R, 0.04, 77, (B, g) => {
    const rnd = B.rnd;
    // top plane: warm wood with grain, seen from just above
    const plane = handPoly([[-L, top - 0.03], [L, top - 0.03], [L - 0.05, top + 0.075], [-L + 0.05, top + 0.075]], 0.004, rnd);
    B.gouache(plane, {
      base: '#8a4f28', box: [-L, top - 0.03, L, top + 0.08], washes: [PAL.wood, PAL.ochre, PAL.umber], strokeAngle: 0, strokes: 70, strokeLen: 1.2,
      strokeColors: [PAL.ochre, PAL.umber, '#b06a34'], shadow: 0.2, lit: 0.15, bottomShade: false, edge: false,
      inner: () => {
        for (let i = 0; i < 14; i++) {
          const y = top - 0.02 + rnd() * 0.09, x = -L + rnd() * 2 * L;
          B.stroke([[x, y], [x + 0.3 + rnd() * 0.5, y + (rnd() - 0.5) * 0.01]], PAL.umber, 1, 0.35);
        }
        // a cream inlay line along the back
        B.stroke([[-L + 0.08, top + 0.06], [L - 0.08, top + 0.06]], PAL.creamDeep, 1.4, 0.45, B.px(0.6));
      }
    });
    B.edge(plane, PAL.ink, 1.4);
    // front apron: terracotta with a painted frieze
    const apron = handPoly([[-L - 0.03, top - 0.03], [L + 0.03, top - 0.03], [L + 0.03, top - P.thick - 0.01], [-L - 0.03, top - P.thick - 0.01]], 0.003, rnd);
    B.gouache(apron, {
      base: PAL.terracotta, box: [-L - 0.03, top - P.thick, L + 0.03, top - 0.03], washes: [PAL.tomato, PAL.orange, PAL.burgundy], strokeAngle: 0, strokes: 40, strokeLen: 0.9,
      shadow: 0.3, lit: 0.2, bottomShade: true,
      inner: () => {
        const y0 = top - P.thick - 0.01, y1 = top - 0.03, ym = (y0 + y1) / 2;
        B.stroke([[-L, y1 - 0.012], [L, y1 - 0.012]], PAL.forest, 3.2, 0.95, B.px(0.6));
        B.stroke([[-L, y0 + 0.012], [L, y0 + 0.012]], PAL.forest, 3.2, 0.95, B.px(0.6));
        // repeating motif: mustard half-moons, cream dots, olive leaves
        for (let x = -L + 0.12, i = 0; x < L - 0.08; x += 0.16, i++) {
          if (i % 2 === 0) {
            B.g.fillStyle = rgba(PAL.mustard, 0.95);
            B.g.beginPath(); B.g.ellipse(x, ym - 0.015, 0.035, 0.03, 0, 0, Math.PI); B.g.fill();
            B.dot(x, ym + 0.022, 1.5, PAL.cream, 0.95);
          } else {
            B.petal(x - 0.045, ym, x, ym + 0.02, 0.01, PAL.olive, 0.95);
            B.petal(x + 0.045, ym, x, ym + 0.02, 0.01, PAL.olive, 0.95);
            B.dot(x, ym - 0.012, 1.8, PAL.cream, 0.95);
          }
        }
      }
    });
    B.edge(apron, PAL.ink, 1.6);
    // scalloped skirt hanging under the apron
    const sk = [];
    const y0 = top - P.thick - 0.01;
    sk.push([-L + 0.06, y0]);
    for (let x = -L + 0.06, i = 0; x <= L - 0.05; x += 0.1, i++) sk.push([x + 0.05, y0 - 0.055 - (i % 2) * 0.006]);
    sk.push([L - 0.06, y0]);
    const skirt = wobblePath(sk, 0.003, rnd);
    B.gouache(skirt, { base: PAL.forest, box: [-L, y0 - 0.07, L, y0], washes: [PAL.olive], strokeAngle: 0, strokes: 18, shadow: 0.3, lit: 0.2, bottomShade: false });
    for (let x = -L + 0.11; x < L - 0.05; x += 0.1) B.dot(x, y0 - 0.035, 1.6, PAL.mustard, 0.9);
    // brass end caps
    for (const s of [-1, 1]) {
      const cap = wobblePath(ellipsePts(s * (L + 0.035), top - 0.095, 0.035, 0.075, 12), 0.002, rnd);
      brassFill(B, cap, [s * (L + 0.035) - 0.035, top - 0.17, s * (L + 0.035) + 0.035, top - 0.02]);
    }
    // the hinge boss at the pivot
    const boss = wobblePath(ellipsePts(0, top - 0.14, 0.07, 0.07, 14), 0.002, rnd);
    brassFill(B, boss, [-0.07, top - 0.21, 0.07, top - 0.07]);
    B.dot(0, top - 0.14, 3, PAL.ink, 0.9);
  });
}

// Ballast: rod from the pivot to an ornamental brass plumb, body-local.
function paintBallast(R) {
  const Lb = PHYS.ballastL;
  return renderSprite([-0.3, -Lb - 0.4, 0.3, 0.1], R, 0.04, 91, (B, g) => {
    const rnd = B.rnd;
    B.stroke([[0, 0.02], [0, -Lb + 0.2]], PAL.brassDark, 6, 1);
    B.stroke([[0, 0.02], [0, -Lb + 0.2]], PAL.brass, 3.2, 1);
    B.stroke([[-0.004, 0], [-0.004, -Lb + 0.22]], PAL.brassLight, 1, 0.7);
    for (const y of [-0.35, -0.7]) { const k = wobblePath(ellipsePts(0, y, 0.03, 0.03, 10), 0.002, rnd); brassFill(B, k, [-0.03, y - 0.03, 0.03, y + 0.03]); }
    const prof = [[0.0, -Lb - 0.33], [0.06, -Lb - 0.22], [0.2, -Lb - 0.06], [0.24, -Lb + 0.04], [0.2, -Lb + 0.13], [0.09, -Lb + 0.19], [0.05, -Lb + 0.24]];
    const bob = wobblePath(lathe(prof), 0.003, rnd);
    brassFill(B, bob, [-0.24, -Lb - 0.33, 0.24, -Lb + 0.24], () => {
      B.stroke([[-0.235, -Lb + 0.02], [0, -Lb + 0.03], [0.235, -Lb + 0.02]], PAL.vermilion, 4, 0.95);
      for (let i = 0; i < 6; i++) B.dot(-0.17 + i * 0.068, -Lb + 0.025, 1.8, PAL.cream, 0.95);
      B.stroke([[-0.18, -Lb - 0.1], [0, -Lb - 0.09], [0.18, -Lb - 0.1]], PAL.brassDark, 1.6, 0.8);
      B.stroke([[-0.16, -Lb + 0.12], [0, -Lb + 0.125], [0.16, -Lb + 0.12]], PAL.brassDark, 1.6, 0.8);
    });
    B.shine([[-0.16, -Lb - 0.06], [-0.19, -Lb + 0.04], [-0.14, -Lb + 0.12]], '#fff6d2', 3, 0.9);
  });
}

// The lyre-shaped stand: two green legs rising from a plinth to the hinge,
// open in the middle so the plumb can swing between them. World coordinates.
function paintStand(R) {
  const fy = PHYS.floorY;
  return renderSprite([-0.95, fy - 0.02, 0.95, 0.12], R, 0.05, 55, (B, g) => {
    const rnd = B.rnd;
    // plinth (matches the collision trapezoid)
    const plinth = handPoly([[-0.75, fy], [0.75, fy], [0.55, fy + 0.28], [-0.55, fy + 0.28]], 0.004, rnd);
    B.gouache(plinth, {
      base: PAL.burgundyDeep, box: [-0.75, fy, 0.75, fy + 0.28], washes: [PAL.wine, PAL.umber], strokeAngle: 0, strokes: 20,
      inner: () => {
        B.stroke([[-0.7, fy + 0.05], [0.7, fy + 0.05]], PAL.mustard, 2.4, 0.9);
        for (let i = 0; i < 9; i++) B.petal(-0.48 + i * 0.12, fy + 0.12, -0.48 + i * 0.12, fy + 0.22, 0.02, PAL.ochre, 0.9);
      }
    });
    // legs
    for (const s of [-1, 1]) {
      const leg = wobblePath([
        [s * 0.34, fy + 0.27], [s * 0.5, fy + 0.27], [s * 0.52, fy + 0.6], [s * 0.42, fy + 1.1], [s * 0.3, fy + 1.55], [s * 0.15, fy + 1.95], [s * 0.06, -0.02],
        [s * 0.02, -0.02], [s * 0.08, fy + 1.9], [s * 0.2, fy + 1.5], [s * 0.3, fy + 1.05], [s * 0.38, fy + 0.62]
      ], 0.003, rnd);
      B.gouache(leg, {
        base: PAL.forest, box: [Math.min(s * 0.52, s * 0.02), fy + 0.27, Math.max(s * 0.52, s * 0.02), 0], washes: [PAL.olive, '#24391f'], strokes: 22, strokeAngle: Math.PI / 2 - s * 0.25,
        inner: () => {
          for (let i = 0; i < 5; i++) { const t = 0.15 + i * 0.17; B.dot(s * lerp(0.44, 0.08, t), lerp(fy + 0.4, -0.1, t), 2, PAL.mustard, 0.9); }
        }
      });
      // brass collars
      const col = wobblePath(ellipsePts(s * 0.37, fy + 1.1, 0.07, 0.03, 10), 0.002, rnd);
      brassFill(B, col, [s * 0.37 - 0.07, fy + 1.07, s * 0.37 + 0.07, fy + 1.13]);
    }
    // the knife-edge fulcrum the hinge rests on
    const knife = handPoly([[-0.12, -0.08], [0.12, -0.08], [0, 0.04]], 0.002, rnd);
    brassFill(B, knife, [-0.12, -0.08, 0.12, 0.04]);
  });
}

// Stage floor: dark boards with a painted front edge. World coordinates.
function paintFloor(R) {
  const fy = PHYS.floorY;
  return renderSprite([-5.2, fy - 3.2, 5.2, fy + 0.08], R, 0, 33, (B, g) => {
    const rnd = B.rnd;
    const top = handPoly([[-5.2, fy - 0.25], [5.2, fy - 0.25], [5.2, fy + 0.06], [-5.2, fy + 0.06]], 0.004, rnd);
    B.gouache(top, {
      base: '#5a2e1c', box: [-5.2, fy - 0.25, 5.2, fy + 0.06], washes: [PAL.umber, PAL.wood, PAL.burgundy], strokeAngle: 0, strokes: 90, strokeLen: 1.6,
      strokeColors: [PAL.wood, PAL.umber, '#7d4a2a'], shadow: 0.1, lit: 0.1, edge: false
    });
    for (let x = -5; x < 5.2; x += 0.9 + rnd() * 0.4) B.stroke([[x, fy + 0.05], [x - 0.15, fy - 0.24]], PAL.ink, 1, 0.35);
    const front = handPoly([[-5.2, fy - 3.2], [5.2, fy - 3.2], [5.2, fy - 0.25], [-5.2, fy - 0.25]], 0.004, rnd);
    B.gouache(front, {
      base: PAL.burgundyDeep, box: [-5.2, fy - 3.2, 5.2, fy - 0.25], washes: [PAL.wine, '#1f070d'], strokeAngle: 0, strokes: 60, strokeLen: 2, shadow: 0.2, lit: 0.1, edge: false,
      inner: () => {
        B.stroke([[-5.2, fy - 0.3], [5.2, fy - 0.3]], PAL.ochre, 3, 0.9, B.px(0.8));
        B.stroke([[-5.2, fy - 0.36], [5.2, fy - 0.36]], PAL.ochre, 1.2, 0.7, B.px(0.6));
      }
    });
    B.stroke([[-5.2, fy + 0.06], [5.2, fy + 0.06]], PAL.ink, 1.6, 0.6, B.px(0.5));
  });
}

// Backdrop at screen resolution: muted burgundy wall, faint painted damask,
// a warm pool of light behind the table and darker theatrical edges.
function paintBackdrop(W, H, dpr, focusY, seed) {
  const c = makeBuffer(W * dpr, H * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const rnd = mulberry(seed);
  const B = makeBrush(g, rnd, 1);
  g.fillStyle = PAL.burgundy;
  g.fillRect(0, 0, W, H);
  // broad layered washes
  for (let i = 0; i < 40; i++) {
    g.fillStyle = rgba([PAL.wine, PAL.burgundyDeep, '#5a1a26', PAL.umber][i % 4], 0.08 + rnd() * 0.1);
    g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 60 + rnd() * 180, 40 + rnd() * 140, rnd() * 3, 0, TAU); g.fill();
  }
  // vertical dry-brush texture
  B.dryBrush([0, 0, W, H], [PAL.wine, PAL.burgundyDeep, '#62202c'], 180, Math.PI / 2, H * 0.25);
  // damask: rows of painted medallions, very low contrast
  const step = 92;
  for (let row = 0, y = 30; y < H + step; y += step, row++) {
    for (let x = (row % 2) * step / 2 - 10; x < W + step; x += step) {
      const col = rgba('#7a2a36', 0.22 + rnd() * 0.08);
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2 + 0.785;
        B.petal(x, y, x + Math.cos(a) * 22, y + Math.sin(a) * 22, 7, '#7a2a36', 0.2 + rnd() * 0.06);
      }
      g.fillStyle = col; g.beginPath(); g.ellipse(x, y, 5, 5, 0, 0, TAU); g.fill();
      g.strokeStyle = rgba(PAL.ochre, 0.07); g.lineWidth = 1.5;
      g.beginPath(); g.ellipse(x, y, 30, 34, 0, 0, TAU); g.stroke();
    }
  }
  // warm light behind the table
  const gl = g.createRadialGradient(W / 2, focusY, 10, W / 2, focusY, Math.max(W, H) * 0.6);
  gl.addColorStop(0, 'rgba(226,120,60,0.30)');
  gl.addColorStop(0.45, 'rgba(160,60,40,0.12)');
  gl.addColorStop(1, 'rgba(20,4,8,0)');
  g.fillStyle = gl; g.fillRect(0, 0, W, H);
  // darker painted edges (theatrical vignette), drawn as brushy bands
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const x = side > 0 ? W - rnd() * 34 : rnd() * 34;
    g.strokeStyle = rgba(PAL.burgundyDeep, 0.18 + rnd() * 0.2);
    g.lineWidth = 18 + rnd() * 30; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, -20); g.bezierCurveTo(x + (rnd() - 0.5) * 30, H * 0.3, x + (rnd() - 0.5) * 30, H * 0.7, x, H + 20); g.stroke();
  }
  const vg = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.max(W, H) * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(20,3,8,0.55)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  return c;
}

// The presentation shelf at the bottom: an olive cloth with a mustard fringe.
function paintTray(W, h, dpr, seed) {
  const c = makeBuffer(W * dpr, (h + 16) * dpr);
  const g = c.getContext('2d');
  g.scale(dpr, dpr);
  const rnd = mulberry(seed);
  const B = makeBrush(g, rnd, 1);
  const cloth = handPoly([[-6, 10], [W + 6, 8], [W + 6, h + 16], [-6, h + 16]], 3, rnd);
  B.gouache(cloth, { base: PAL.forest, box: [0, 8, W, h + 16], washes: [PAL.olive, '#1d301b'], strokeAngle: 0, strokes: 80, strokeLen: W * 0.3, shadow: 0.2, lit: 0.12, bottomShade: false, edge: false });
  // fringe and border
  B.stroke([[0, 14], [W, 13]], PAL.mustard, 3.5, 0.95, 1);
  B.stroke([[0, 20], [W, 19.5]], PAL.ochre, 1.5, 0.8, 1);
  for (let x = 4; x < W; x += 7) B.stroke([[x, 9], [x + (rnd() - 0.5) * 2, 2 + rnd() * 3]], PAL.mustard, 1.6, 0.85);
  for (let x = 18; x < W; x += 36) B.dot(x, 26, 2, PAL.cream, 0.6);
  return c;
}
