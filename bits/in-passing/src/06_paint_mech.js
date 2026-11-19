// ---------------------------------------------------------------------------
// Painted machines and creatures. The rule of the visual language:
//  - anything you can stand on has a pale, warm lip along its top edge
//  - anything you can hold is a dusty coral ring
// Machines are wood, canvas, rope and painted tin, never a wall of brass gears.
// ---------------------------------------------------------------------------

function lipStroke(g, x0, x1, y, P) {
  g.save();
  g.strokeStyle = shadeC(P.stoneLight, 0.15); g.lineWidth = 7; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0 + 3, y + 3); g.lineTo(x1 - 3, y + 3); g.stroke();
  g.strokeStyle = rgba(P.ink, 0.35); g.lineWidth = 2;
  g.beginPath(); g.moveTo(x0 + 2, y + 7.5); g.lineTo(x1 - 2, y + 7.5); g.stroke();
  g.restore();
}

// Skiff: 2.6 m deck. Canvas 512x256, deck line at y=96, deck spans x 46..466.
function paintSkiff(seed, P) {
  const rng = makeRng(seed);
  const c = cv(512, 256), g = c.getContext('2d');
  // awning poles + striped awning
  g.strokeStyle = P.woodDark; g.lineWidth = 6;
  for (const x of [130, 330]) { g.beginPath(); g.moveTo(x, 96); g.lineTo(x, 20); g.stroke(); }
  polyPaint(g, [[110, 26], [350, 14], [360, 40], [104, 50]], P.cloth, rng, { streaks: 6 });
  for (let i = 0; i < 6; i++) { g.fillStyle = rgba(P.coral, 0.85); g.fillRect(118 + i * 40, 22 - i * 2, 18, 26); }
  // hull
  polyPaint(g, [[30, 96], [482, 96], [452, 168], [392, 196], [110, 196], [56, 160]], P.wood, rng, { streaks: 30, streakAng: 0 });
  for (let y = 120; y < 190; y += 18) { g.strokeStyle = rgba(P.woodDark, 0.4); g.lineWidth = 2; g.beginPath(); g.moveTo(50, y); g.lineTo(470, y); g.stroke(); }
  rectPaint(g, 26, 90, 460, 14, P.woodLight, rng, { streaks: 4 });
  lipStroke(g, 30, 482, 88, P);
  // painted eye on the bow, a lantern, a rope coil
  blobPaint(g, 440, 128, 11, P.cloth, rng, {}); blobPaint(g, 442, 128, 5, P.ink, rng, { edge: false });
  g.strokeStyle = P.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(470, 92); g.lineTo(470, 56); g.stroke();
  blobPaint(g, 470, 54, 8, P.yellow, rng, {});
  return c;
}

// Lift cage: 2.0 m floor. 256x256, floor line y=200, spans x 20..236.
function paintCage(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 256), g = c.getContext('2d');
  const fr = P.woodDark;
  // roof
  polyPaint(g, [[10, 40], [128, 6], [246, 40], [236, 52], [20, 52]], P.roof[seed % P.roof.length], rng, {});
  // lattice sides
  g.strokeStyle = fr; g.lineWidth = 7;
  for (const x of [24, 232]) { g.beginPath(); g.moveTo(x, 50); g.lineTo(x, 204); g.stroke(); }
  g.lineWidth = 3; g.strokeStyle = rgba(fr, 0.8);
  for (let i = 0; i < 4; i++) { g.beginPath(); g.moveTo(24, 60 + i * 36); g.lineTo(60, 96 + i * 36); g.stroke(); g.beginPath(); g.moveTo(232, 60 + i * 36); g.lineTo(196, 96 + i * 36); g.stroke(); }
  g.beginPath(); g.moveTo(24, 130); g.lineTo(232, 130); g.stroke();
  // floor
  rectPaint(g, 14, 200, 228, 26, P.wood, rng, { streaks: 6 });
  lipStroke(g, 16, 240, 194, P);
  // hanging lamp
  g.strokeStyle = P.ink; g.lineWidth = 2; g.beginPath(); g.moveTo(128, 52); g.lineTo(128, 72); g.stroke();
  blobPaint(g, 128, 78, 7, P.yellow, rng, {});
  return c;
}

// Lift tower lattice, vertically tileable. 128x256.
function paintLattice(seed, P) {
  const rng = makeRng(seed);
  const c = cv(128, 256), g = c.getContext('2d');
  g.strokeStyle = P.woodDark; g.lineCap = 'round';
  g.lineWidth = 9; for (const x of [12, 116]) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 256); g.stroke(); }
  g.lineWidth = 5;
  g.beginPath(); g.moveTo(12, 0); g.lineTo(116, 128); g.lineTo(12, 256); g.stroke();
  g.beginPath(); g.moveTo(116, 0); g.lineTo(12, 128); g.lineTo(116, 256); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.moveTo(12, 128); g.lineTo(116, 128); g.stroke();
  g.globalAlpha = 0.25; g.globalCompositeOperation = 'source-atop'; g.fillStyle = grainPattern(g); g.fillRect(0, 0, 128, 256);
  void rng;
  return c;
}

function paintPulley(P) {
  const rng = makeRng(31);
  const c = cv(128, 128), g = c.getContext('2d');
  blobPaint(g, 64, 64, 56, P.wood, rng, {});
  blobPaint(g, 64, 64, 44, shadeC(P.wood, -0.2), rng, { edge: false });
  for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; g.strokeStyle = P.woodLight; g.lineWidth = 7; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 44, 64 + Math.sin(a) * 44); g.stroke(); }
  blobPaint(g, 64, 64, 11, P.coral, rng, {});
  return c;
}

function paintCounterweight(P) {
  const rng = makeRng(41);
  const c = cv(128, 192), g = c.getContext('2d');
  polyPaint(g, [[20, 20], [108, 20], [100, 180], [28, 180]], P.metal, rng, { streaks: 10 });
  for (let y = 50; y < 170; y += 30) rectPaint(g, 26, y, 76, 6, shadeC(P.metal, 0.2), rng, { streaks: 0 });
  // a stencilled number nobody remembers the meaning of
  g.fillStyle = rgba(P.cloth, 0.7); g.font = 'bold 30px serif'; g.fillText('7', 54, 120);
  return c;
}

// The lift operator's booth, with the operator, who sometimes has tea.
function paintBooth(seed, P, tea) {
  const rng = makeRng(seed);
  const c = cv(256, 256), g = c.getContext('2d');
  rectPaint(g, 40, 90, 176, 150, mixC(P.stone, P.cloth, 0.3), rng, { streaks: 14 });
  polyPaint(g, [[28, 96], [128, 40], [228, 96]], P.roof[1], rng, {});
  windowPaint(g, 70, 120, 116, 60, P, rng, {});
  tinyFigure(g, 118, 182, 62, P, rng, { coat: P.roof[0] });
  if (tea) { rectPaint(g, 142, 150, 14, 14, P.cloth, rng, {}); g.strokeStyle = rgba('#ffffff', 0.6); g.lineWidth = 2; g.beginPath(); g.moveTo(149, 146); g.quadraticCurveTo(156, 134, 148, 124); g.stroke(); }
  // crank wheel
  blobPaint(g, 196, 200, 18, P.coral, rng, {});
  return c;
}

// Bellows: body tile (accordion folds), 256x128 tile stretched vertically.
function paintBellowsBody(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 128), g = c.getContext('2d');
  const col = mixC(P.coral, P.wood, 0.45);
  for (let i = 0; i < 4; i++) {
    const y = i * 32;
    polyPaint(g, [[18, y], [238, y], [250, y + 16], [238, y + 32], [18, y + 32], [6, y + 16]], i % 2 ? col : shadeC(col, -0.12), rng, { streaks: 5, streakAng: 0, j: 1 });
  }
  return c;
}
function paintBellowsTop(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 64), g = c.getContext('2d');
  rectPaint(g, 4, 12, 248, 30, P.woodLight, rng, { streaks: 8 });
  lipStroke(g, 4, 252, 6, P);
  for (const x of [30, 226]) blobPaint(g, x, 28, 6, P.metal, rng, {});
  return c;
}
function paintBellowsBase(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 192), g = c.getContext('2d');
  polyPaint(g, [[0, 30], [256, 30], [236, 192], [20, 192]], P.stone, rng, { streaks: 16 });
  rectPaint(g, -4, 20, 264, 22, P.wood, rng, {});
  // a bird nest on the side, because birds like warm air
  blobPaint(g, 210, 60, 16, P.woodDark, rng, { j: 4 });
  blobPaint(g, 206, 52, 5, P.cloth, rng, {});
  return c;
}

// The great wheel (rim + spokes + hub). 1024 square for diameter 2R.
function paintWheel(seed, P) {
  const rng = makeRng(seed);
  const S = 1024, c = cv(S, S), g = c.getContext('2d');
  const C = S / 2, R = S * 0.47;
  const col = P.wood;
  g.lineCap = 'round';
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU;
    g.strokeStyle = shadeC(col, -0.15); g.lineWidth = 16;
    g.beginPath(); g.moveTo(C + Math.cos(a) * 40, C + Math.sin(a) * 40); g.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R); g.stroke();
    g.strokeStyle = rgba(shadeC(col, 0.25), 0.6); g.lineWidth = 4;
    g.beginPath(); g.moveTo(C + Math.cos(a) * 40, C + Math.sin(a) * 40); g.lineTo(C + Math.cos(a) * R, C + Math.sin(a) * R); g.stroke();
  }
  for (const r of [R, R * 0.93, R * 0.55]) {
    g.strokeStyle = shadeC(col, -0.25); g.lineWidth = r === R ? 30 : 12;
    g.beginPath(); g.arc(C, C, r, 0, TAU); g.stroke();
    g.strokeStyle = rgba(shadeC(col, 0.3), 0.55); g.lineWidth = r === R ? 8 : 4;
    g.beginPath(); g.arc(C, C, r - 4, Math.PI * 1.0, Math.PI * 1.7); g.stroke();
  }
  // paddles / little flowerpots tied along the rim (it is an orchard wheel)
  for (let i = 0; i < 24; i++) {
    const a = (i + 0.5) / 24 * TAU;
    const x = C + Math.cos(a) * R * 0.965, y = C + Math.sin(a) * R * 0.965;
    blobPaint(g, x, y, 10, i % 3 === 0 ? P.coral : P.leaf, rng, { edge: false, streaks: 1 });
  }
  blobPaint(g, C, C, 56, P.woodDark, rng, {});
  blobPaint(g, C, C, 26, P.coral, rng, {});
  return c;
}

// Wheel support A-frame. 512x1024; hub at (256, 120).
function paintWheelStand(seed, P) {
  const rng = makeRng(seed);
  const c = cv(512, 1024), g = c.getContext('2d');
  polyPaint(g, [[236, 110], [276, 110], [470, 1024], [400, 1024]], shadeC(P.wood, -0.2), rng, { streaks: 20, streakAng: 1.35 });
  polyPaint(g, [[236, 110], [276, 110], [110, 1024], [40, 1024]], shadeC(P.wood, -0.1), rng, { streaks: 20, streakAng: 1.8 });
  rectPaint(g, 150, 600, 220, 20, P.woodDark, rng, {});
  return c;
}

// Gondola: 1.7 m floor. 256x256, floor at y=196, x 22..234; hangs from (128,10).
function paintGondola(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 256), g = c.getContext('2d');
  g.strokeStyle = P.woodDark; g.lineWidth = 5;
  g.beginPath(); g.moveTo(128, 10); g.lineTo(40, 120); g.moveTo(128, 10); g.lineTo(216, 120); g.stroke();
  blobPaint(g, 128, 12, 10, P.metal, rng, {});
  // a basket
  polyPaint(g, [[24, 196], [232, 196], [214, 246], [42, 246]], mixC(P.wood, P.yellow, 0.25), rng, { streaks: 18, streakAng: 0 });
  for (let x = 40; x < 220; x += 18) { g.strokeStyle = rgba(P.woodDark, 0.35); g.lineWidth = 2; g.beginPath(); g.moveTo(x, 198); g.lineTo(x + 6, 244); g.stroke(); }
  lipStroke(g, 22, 234, 189, P);
  // apples
  if (seed % 2) for (let i = 0; i < 4; i++) blobPaint(g, 70 + i * 34, 190, 9, i % 2 ? P.coral : P.yellow, rng, { edge: 0.3, streaks: 0 });
  return c;
}

// Swing crane: tower with a jib reaching right. 512x1024. Pivot at (420, 120).
function paintCrane(seed, P) {
  const rng = makeRng(seed);
  const c = cv(512, 1024), g = c.getContext('2d');
  // mast
  polyPaint(g, [[70, 1024], [86, 90], [126, 90], [150, 1024]], P.wood, rng, { streaks: 30, streakAng: -1.5 });
  for (let y = 180; y < 1024; y += 120) { g.strokeStyle = rgba(P.woodDark, 0.6); g.lineWidth = 5; g.beginPath(); g.moveTo(80, y); g.lineTo(140, y + 60); g.stroke(); }
  // jib
  polyPaint(g, [[90, 92], [440, 108], [440, 134], [96, 150]], P.woodLight, rng, { streaks: 14, streakAng: 0.05 });
  g.strokeStyle = P.woodDark; g.lineWidth = 4;
  g.beginPath(); g.moveTo(106, 40); g.lineTo(436, 112); g.moveTo(106, 40); g.lineTo(106, 92); g.stroke();
  // a flag and a little bucket of stones as counterweight
  g.fillStyle = P.coral; g.beginPath(); g.moveTo(106, 40); g.lineTo(150, 50); g.lineTo(106, 64); g.fill();
  rectPaint(g, 40, 140, 40, 46, P.metal, rng, {});
  blobPaint(g, 420, 122, 14, P.metal, rng, {});
  return c;
}

// Wheelhouse at the ends of a cable line. 256x512.
function paintWheelhouse(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 512), g = c.getContext('2d');
  polyPaint(g, [[60, 512], [80, 150], [176, 150], [196, 512]], mixC(P.stone, P.near, 0.3), rng, { streaks: 30, streakAng: -1.45 });
  rectPaint(g, 40, 70, 176, 100, P.cloth, rng, {});
  polyPaint(g, [[30, 76], [128, 20], [226, 76]], P.roof[0], rng, {});
  blobPaint(g, 128, 120, 34, P.wood, rng, {});
  blobPaint(g, 128, 120, 12, P.coral, rng, {});
  windowPaint(g, 118, 240, 20, 34, P, rng, { figure: true });
  return c;
}

function paintTrolley(P) {
  const rng = makeRng(51);
  const c = cv(128, 128), g = c.getContext('2d');
  blobPaint(g, 46, 30, 14, P.metal, rng, {}); blobPaint(g, 82, 30, 14, P.metal, rng, {});
  rectPaint(g, 34, 34, 60, 22, P.woodLight, rng, {});
  g.strokeStyle = P.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(64, 56); g.lineTo(64, 74); g.stroke();
  return c;
}

// Strider body: 512x256. Deck sits on top at y=70 (x 96..416).
function paintStriderBody(seed, P, goal) {
  const rng = makeRng(seed);
  const c = cv(512, 256), g = c.getContext('2d');
  const hide = goal ? mixC(P.far, P.stone, 0.4) : mixC(P.leafDark, P.stone, 0.35);
  // long neck and patient head
  g.save(); g.beginPath(); g.moveTo(400, 120); g.quadraticCurveTo(470, 80, 478, 30); g.lineTo(500, 34); g.quadraticCurveTo(490, 100, 420, 150); g.closePath(); paintFill(g, hide, rng, { streaks: 6 }); g.restore();
  blobPaint(g, 488, 30, 18, hide, rng, {});
  blobPaint(g, 494, 26, 4, P.ink, rng, { edge: false });
  // body
  g.save(); g.beginPath(); g.ellipse(256, 130, 190, 70, 0, 0, TAU); paintFill(g, hide, rng, { x0: 66, x1: 446, y0: 60, y1: 200, streaks: 40 }); g.restore();
  // painted saddle cloth
  polyPaint(g, [[120, 90], [392, 90], [372, 170], [140, 170]], P.coral, rng, { streaks: 10 });
  for (let i = 0; i < 6; i++) blobPaint(g, 160 + i * 38, 150, 6, P.yellow, rng, { edge: false });
  // deck
  rectPaint(g, 90, 66, 332, 26, P.woodLight, rng, { streaks: 8 });
  lipStroke(g, 92, 420, 60, P);
  return c;
}

// The walking house the post goes to. 512x512 sits on the walker deck (porch at y=440).
function paintWalkerHouse(seed, P, lit) {
  const rng = makeRng(seed);
  const c = cv(512, 512), g = c.getContext('2d');
  rectPaint(g, 150, 180, 260, 260, mixC(P.stone, P.cloth, 0.3), rng, { streaks: 30, streakAng: -1.4 });
  polyPaint(g, [[120, 190], [280, 50], [440, 190]], P.roof[1], rng, { streaks: 20 });
  rectPaint(g, 330, 80, 26, 80, shadeC(P.stone, -0.1), rng, {});
  windowPaint(g, 200, 240, 40, 56, P, rng, { shutters: true, lit });
  windowPaint(g, 320, 240, 40, 56, P, rng, { shutters: true, plant: true, lit });
  rectPaint(g, 250, 330, 54, 110, P.roof[0], rng, {});
  // the letterbox, hopefully waiting
  rectPaint(g, 320, 360, 36, 28, P.coral, rng, {});
  g.fillStyle = P.ink; g.fillRect(326, 372, 24, 4);
  // porch
  rectPaint(g, 20, 436, 472, 26, P.woodLight, rng, { streaks: 10 });
  lipStroke(g, 22, 490, 430, P);
  for (const x of [40, 140, 470]) { g.strokeStyle = P.woodDark; g.lineWidth = 6; g.beginPath(); g.moveTo(x, 436); g.lineTo(x, 380); g.stroke(); }
  g.strokeStyle = P.woodDark; g.lineWidth = 4; g.beginPath(); g.moveTo(40, 384); g.lineTo(140, 384); g.stroke();
  // a flag of welcome
  g.strokeStyle = P.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(130, 190); g.lineTo(130, 120); g.stroke();
  g.fillStyle = P.yellow; g.beginPath(); g.moveTo(130, 120); g.lineTo(176, 132); g.lineTo(130, 146); g.fill();
  return c;
}

// Water: horizontally tileable band with ripples. 256x128.
function paintWater(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 128), g = c.getContext('2d');
  const lg = g.createLinearGradient(0, 0, 0, 128);
  lg.addColorStop(0, P.waterLight); lg.addColorStop(0.15, P.water); lg.addColorStop(1, shadeC(P.water, -0.35));
  g.fillStyle = lg; g.fillRect(0, 0, 256, 128);
  for (let i = 0; i < 40; i++) {
    const x = rng() * 256, y = 10 + rng() * 110, w = 10 + rng() * 30;
    g.strokeStyle = rgba(P.waterLight, 0.25 + rng() * 0.3); g.lineWidth = 1.5 + rng() * 2;
    for (const off of [0, -256, 256]) { g.beginPath(); g.moveTo(x + off, y); g.lineTo(x + off + w, y); g.stroke(); }
  }
  g.fillStyle = rgba('#ffffff', 0.6); g.fillRect(0, 0, 256, 3);
  return c;
}

// Dark, soft foreground silhouettes: hanging vines, reeds, bunting.
function paintForeground(seed, P, kind) {
  const rng = makeRng(seed);
  const c = cv(256, 512), g = c.getContext('2d');
  const col = shadeC(mixC(P.leafDark, P.ink, 0.5), -0.25);
  g.filter = 'blur(2px)';
  if (kind === 'vines') {
    for (let k = 0; k < 6; k++) {
      let x = 20 + rng() * 216, y = 0;
      const len = 150 + rng() * 330;
      g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.moveTo(x, 0);
      while (y < len) { y += 12; x += (rng() - 0.5) * 6; g.lineTo(x, y); }
      g.stroke();
      for (let yy = 10; yy < len; yy += 14) { g.fillStyle = col; g.beginPath(); g.ellipse(x + (rng() - 0.5) * 10, yy, 7, 4, rng() * 3, 0, TAU); g.fill(); }
    }
  } else if (kind === 'reeds') {
    for (let k = 0; k < 18; k++) {
      const x = 10 + rng() * 236, h = 200 + rng() * 300, bend = (rng() - 0.3) * 50;
      g.strokeStyle = col; g.lineWidth = 3 + rng() * 3; g.beginPath(); g.moveTo(x, 512); g.quadraticCurveTo(x, 512 - h * 0.6, x + bend, 512 - h); g.stroke();
      if (rng.chance(0.4)) { g.fillStyle = col; g.beginPath(); g.ellipse(x + bend, 512 - h, 5, 16, 0, 0, TAU); g.fill(); }
    }
  } else {
    // a post with bunting
    g.fillStyle = col; g.fillRect(110, 40, 22, 472);
    g.strokeStyle = col; g.lineWidth = 2; g.beginPath(); g.moveTo(120, 60); g.quadraticCurveTo(200, 120, 256, 90); g.stroke();
    for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? mixC(P.coral, col, 0.55) : mixC(P.yellow, col, 0.55); const x = 140 + i * 24, y = 80 + Math.sin(i) * 10 + i * 4; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 16, y + 2); g.lineTo(x + 8, y + 22); g.fill(); }
  }
  g.filter = 'none';
  return c;
}

// Small props that sit on piers and tell little stories.
function paintProp(seed, P, kind) {
  const rng = makeRng(seed);
  const c = cv(128, 192), g = c.getContext('2d');
  if (kind === 'lamp') {
    g.strokeStyle = P.ink; g.lineWidth = 5; g.beginPath(); g.moveTo(64, 192); g.lineTo(64, 40); g.quadraticCurveTo(64, 20, 90, 22); g.stroke();
    blobPaint(g, 92, 36, 12, P.yellow, rng, {});
  } else if (kind === 'waiter') {
    // somebody waiting with a suitcase, looking at the thing that will come back
    tinyFigure(g, 60, 186, 92, P, rng, { coat: rng.pick(P.roof) });
    rectPaint(g, 78, 156, 30, 30, P.woodLight, rng, {});
  } else if (kind === 'pots') {
    for (let i = 0; i < 3; i++) { rectPaint(g, 14 + i * 36, 150, 30, 40, P.coral, rng, {}); for (let k = 0; k < 4; k++) blobPaint(g, 22 + i * 36 + rng() * 16, 140 - rng() * 30, 8 + rng() * 6, P.leaf, rng, { edge: false }); }
  } else if (kind === 'cat') {
    blobPaint(g, 60, 172, 20, P.ink, rng, { j: 1 }); blobPaint(g, 84, 156, 12, P.ink, rng, {});
    g.fillStyle = P.ink; g.beginPath(); g.moveTo(78, 148); g.lineTo(80, 136); g.lineTo(86, 146); g.moveTo(88, 146); g.lineTo(92, 136); g.lineTo(94, 150); g.fill();
    g.strokeStyle = P.ink; g.lineWidth = 5; g.beginPath(); g.moveTo(42, 176); g.quadraticCurveTo(20, 170, 26, 140); g.stroke();
  } else if (kind === 'bollard') {
    rectPaint(g, 46, 120, 36, 72, P.metal, rng, {});
    g.strokeStyle = P.cloth; g.lineWidth = 4; for (let i = 0; i < 3; i++) { g.beginPath(); g.ellipse(64, 150 + i * 8, 22, 6, 0, 0, TAU); g.stroke(); }
  } else if (kind === 'sign') {
    g.strokeStyle = P.woodDark; g.lineWidth = 6; g.beginPath(); g.moveTo(64, 192); g.lineTo(64, 60); g.stroke();
    polyPaint(g, [[20, 60], [110, 60], [122, 80], [110, 100], [20, 100]], P.cloth, rng, {});
    g.strokeStyle = rgba(P.ink, 0.6); g.lineWidth = 2; for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(30, 72 + i * 9); g.lineTo(96 - i * 10, 72 + i * 9); g.stroke(); }
  }
  return c;
}
