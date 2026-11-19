// ---------------------------------------------------------------------------
// The painter. Every image in the game is painted here at start-up with
// Canvas2D brushes: wobbly hand-cut shapes, soft directional light from the
// upper left, cool shadows, brush streaks and paper grain. No image assets.
// ---------------------------------------------------------------------------

const PALETTES = [
  { // The Ferry Steps: morning, pale cyan and limestone
    skyTop: '#9fcad3', skyMid: '#cfe3df', haze: '#eee4cf', sun: '#fff3d6',
    far: '#a9c3c6', mid: '#9db9b3', near: '#c8b79a',
    stone: '#d8c7a3', stoneLight: '#efe2c4', stoneDark: '#9a8a73',
    wood: '#8b6a4f', woodLight: '#b48d66', woodDark: '#5a4434',
    roof: ['#5f8f8a', '#c77d64', '#7c9a6a', '#4e7477'], shutter: ['#d48a6a', '#5f8f8a', '#d9b45a'],
    leaf: '#86a873', leafDark: '#5d7f5c', moss: '#93ad78',
    water: '#4f8d88', waterLight: '#9cc7bf', cloth: '#e9dcc0',
    coral: '#d9785f', yellow: '#e4b84e', ink: '#24423f', metal: '#6f7f7c'
  },
  { // The Wheel Orchard: noon, muted yellow and green
    skyTop: '#a8cdc4', skyMid: '#dbe6cf', haze: '#f2e6c2', sun: '#fff1c4',
    far: '#b3c4ad', mid: '#a7bb92', near: '#d1bd93',
    stone: '#dccaa0', stoneLight: '#f2e4bd', stoneDark: '#a08c6c',
    wood: '#8f6b48', woodLight: '#bb9264', woodDark: '#5d4532',
    roof: ['#b9894f', '#6f9a72', '#c4735a', '#53786c'], shutter: ['#6f9a72', '#c4735a', '#e0b85a'],
    leaf: '#8fb06a', leafDark: '#5f8452', moss: '#9db56f',
    water: '#5a9488', waterLight: '#a6cdb8', cloth: '#efe0b8',
    coral: '#d2765c', yellow: '#e6bb47', ink: '#2c4434', metal: '#7a806d'
  },
  { // The High Lines: afternoon, powder blue and dusty coral
    skyTop: '#93b3d6', skyMid: '#c9d6e6', haze: '#efd8cb', sun: '#ffe9d6',
    far: '#a7b6cf', mid: '#a8b1c4', near: '#cdb6a6',
    stone: '#d9c3ad', stoneLight: '#f0e0cf', stoneDark: '#9b8778',
    wood: '#86664f', woodLight: '#ad8a6c', woodDark: '#574238',
    roof: ['#4d6f8a', '#c9705e', '#6c8aa3', '#8e6a8a'], shutter: ['#c9705e', '#4d6f8a', '#e0b45c'],
    leaf: '#7fa088', leafDark: '#557563', moss: '#8ea98a',
    water: '#5a7f98', waterLight: '#a9c2d4', cloth: '#efe1d4',
    coral: '#dc6f5a', yellow: '#e8b64f', ink: '#253a4d', metal: '#6c7686'
  },
  { // The Long Evening: dusk, coral and deep teal, lamps lit
    skyTop: '#6f8fb0', skyMid: '#d9a7a0', haze: '#f0c6a4', sun: '#ffd9a8',
    far: '#9a93ab', mid: '#8d8ea4', near: '#b9a08f',
    stone: '#cfb39a', stoneLight: '#ead2b6', stoneDark: '#8a7368',
    wood: '#7c5b48', woodLight: '#a17b62', woodDark: '#4d3934',
    roof: ['#3f6672', '#b8604f', '#5d6f8c', '#7d5a73'], shutter: ['#e2a052', '#3f6672', '#b8604f'],
    leaf: '#6e8b78', leafDark: '#4b6658', moss: '#7d977c',
    water: '#46677c', waterLight: '#90a9bd', cloth: '#ecd6c0',
    coral: '#e0705a', yellow: '#f0bf55', ink: '#1f3240', metal: '#5e6474'
  }
];

// ---- colour helpers --------------------------------------------------------
function hexRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbHex(r, g, b) { return '#' + [r, g, b].map(v => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join(''); }
function mixC(a, b, t) { const x = hexRgb(a), y = hexRgb(b); return rgbHex(lerp(x[0], y[0], t), lerp(x[1], y[1], t), lerp(x[2], y[2], t)); }
function shadeC(c, amt) { return amt >= 0 ? mixC(c, '#fff8ea', amt) : mixC(c, '#1d2b3a', -amt); }
function rgba(c, a) { const x = hexRgb(c); return `rgba(${x[0]},${x[1]},${x[2]},${a})`; }
function jitterC(c, rng, amt) { const x = hexRgb(c); const k = (rng() - 0.5) * amt * 255; return rgbHex(x[0] + k + (rng() - 0.5) * 10, x[1] + k, x[2] + k + (rng() - 0.5) * 10); }

// ---- canvas helpers --------------------------------------------------------
function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

let _grain = null;
function grainPattern(g) {
  if (!_grain) {
    _grain = cv(128, 128);
    const gg = _grain.getContext('2d');
    const id = gg.createImageData(128, 128);
    const r = makeRng(77);
    for (let i = 0; i < id.data.length; i += 4) {
      const v = 128 + (r() - 0.5) * 120;
      id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
    }
    gg.putImageData(id, 0, 0);
  }
  return g.createPattern(_grain, 'repeat');
}

// A hand-cut outline: subdivide and jitter each edge a little.
function wobPath(g, pts, rng, j, closed) {
  g.beginPath();
  const n = pts.length;
  const segs = closed === false ? n - 1 : n;
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.floor(len / 14));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const jj = k === steps ? 0 : j;
      g.lineTo(lerp(a[0], b[0], t) + (rng() - 0.5) * jj, lerp(a[1], b[1], t) + (rng() - 0.5) * jj);
    }
  }
  if (closed !== false) g.closePath();
}

// Fill the current path with a painted surface: base, light, streaks, grain, edge.
function paintFill(g, base, rng, o) {
  o = o || {};
  const b = g.canvas;
  g.save();
  g.fillStyle = base; g.fill();
  g.clip();
  const x0 = o.x0 || 0, y0 = o.y0 || 0, x1 = o.x1 || b.width, y1 = o.y1 || b.height;
  // light from the upper left, shadow to the lower right
  const lg = g.createLinearGradient(x0, y0, x0 + (x1 - x0) * 0.7, y1);
  lg.addColorStop(0, rgba(shadeC(base, 0.5), o.light == null ? 0.35 : o.light));
  lg.addColorStop(0.55, rgba(base, 0));
  lg.addColorStop(1, rgba(shadeC(base, -0.5), o.dark == null ? 0.35 : o.dark));
  g.fillStyle = lg; g.fillRect(x0, y0, x1 - x0, y1 - y0);
  // brush streaks
  const n = o.streaks == null ? 26 : o.streaks;
  for (let i = 0; i < n; i++) {
    const sx = lerp(x0, x1, rng()), sy = lerp(y0, y1, rng());
    const L = (o.streakLen || 26) * (0.5 + rng());
    const ang = (o.streakAng == null ? -0.25 : o.streakAng) + (rng() - 0.5) * 0.5;
    g.strokeStyle = rgba(shadeC(base, (rng() - 0.45) * 0.5), 0.08 + rng() * 0.1);
    g.lineWidth = (o.streakW || 4) * (0.5 + rng());
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(ang) * L, sy + Math.sin(ang) * L); g.stroke();
  }
  // grain
  g.globalAlpha = o.grain == null ? 0.16 : o.grain;
  g.globalCompositeOperation = 'overlay';
  g.fillStyle = grainPattern(g); g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.restore();
  if (o.edge !== false) {
    g.save();
    g.strokeStyle = rgba(shadeC(base, -0.55), o.edge || 0.38);
    g.lineWidth = o.edgeW || 1.6;
    g.stroke();
    g.restore();
  }
}

function polyPaint(g, pts, base, rng, o) { wobPath(g, pts, rng, (o && o.j) || 2.2, true); paintFill(g, base, rng, o); }
function rectPaint(g, x, y, w, h, base, rng, o) {
  polyPaint(g, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], base, rng, Object.assign({ x0: x, y0: y, x1: x + w, y1: y + h }, o));
}
function circlePath(g, cx, cy, r, rng, j) {
  const pts = [];
  const n = Math.max(10, Math.floor(r * 0.7));
  for (let i = 0; i < n; i++) { const a = i / n * TAU; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); }
  wobPath(g, pts, rng, j == null ? 1.5 : j, true);
}
function blobPaint(g, cx, cy, r, base, rng, o) { circlePath(g, cx, cy, r, rng, (o && o.j) || 2); paintFill(g, base, rng, Object.assign({ x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r, streakLen: r * 0.5 }, o)); }

// Soft cast shadow or glow.
function softEllipse(g, cx, cy, rx, ry, color, a) {
  g.save(); g.translate(cx, cy); g.scale(1, ry / rx);
  const rg = g.createRadialGradient(0, 0, 0, 0, 0, rx);
  rg.addColorStop(0, rgba(color, a)); rg.addColorStop(1, rgba(color, 0));
  g.fillStyle = rg; g.beginPath(); g.arc(0, 0, rx, 0, TAU); g.fill(); g.restore();
}

function windowPaint(g, x, y, w, h, P, rng, opts) {
  const lit = opts && opts.lit;
  rectPaint(g, x - 2, y - 2, w + 4, h + 4, shadeC(P.stone, -0.25), rng, { streaks: 0, edge: 0.2 });
  g.fillStyle = lit ? '#f6cf7a' : mixC(P.ink, P.skyTop, 0.35);
  g.fillRect(x, y, w, h);
  if (!lit) { g.fillStyle = rgba(P.skyMid, 0.35); g.fillRect(x, y, w * 0.4, h); }
  if (h > w * 1.2) {
    // arched top
    g.fillStyle = shadeC(P.stone, -0.25); g.beginPath(); g.arc(x + w / 2, y, w / 2 + 2, Math.PI, 0); g.fill();
    g.fillStyle = lit ? '#f6cf7a' : mixC(P.ink, P.skyTop, 0.35); g.beginPath(); g.arc(x + w / 2, y, w / 2, Math.PI, 0); g.fill();
  }
  if (opts && opts.shutters) {
    const sc = rng.pick(P.shutter);
    rectPaint(g, x - w * 0.55, y, w * 0.5, h, sc, rng, { streaks: 3, edge: 0.3 });
    rectPaint(g, x + w * 1.05, y, w * 0.5, h, sc, rng, { streaks: 3, edge: 0.3 });
  }
  if (opts && opts.plant) {
    rectPaint(g, x - 3, y + h, w + 6, 6, P.coral, rng, { streaks: 0 });
    for (let i = 0; i < 5; i++) blobPaint(g, x + rng() * w, y + h - 2, 4 + rng() * 4, rng.chance(0.3) ? P.coral : P.leaf, rng, { edge: false, streaks: 2 });
  }
  if (opts && opts.figure) tinyFigure(g, x + w / 2, y + h, h * 0.55, P, rng, { coat: rng.pick(P.shutter) });
}

// A tiny inhabitant (bust or full figure), the little stories in the world.
function tinyFigure(g, x, y, h, P, rng, o) {
  o = o || {};
  const coat = o.coat || rng.pick(P.roof);
  const skin = rng.pick(['#e8c3a4', '#c99878', '#9c6e52', '#efd2b8']);
  g.save();
  g.translate(x, y);
  if (o.flip) g.scale(-1, 1);
  const bw = h * 0.42;
  g.beginPath(); g.moveTo(-bw / 2, 0); g.quadraticCurveTo(-bw / 2, -h * 0.62, 0, -h * 0.64); g.quadraticCurveTo(bw / 2, -h * 0.62, bw / 2, 0); g.closePath();
  paintFill(g, coat, rng, { streaks: 2, edgeW: 1 });
  circlePath(g, 0, -h * 0.76, h * 0.15, rng, 0.6); paintFill(g, skin, rng, { streaks: 0, edgeW: 1 });
  if (o.hat !== false && rng.chance(0.6)) { g.fillStyle = rng.pick([P.ink, P.yellow, P.coral, P.cloth]); g.beginPath(); g.ellipse(0, -h * 0.88, h * 0.2, h * 0.06, 0, 0, TAU); g.fill(); g.fillRect(-h * 0.1, -h * 1.0, h * 0.2, h * 0.12); }
  g.restore();
}

// ---- world pieces ------------------------------------------------------------

function paintCloud(seed, P) {
  const rng = makeRng(seed);
  const c = cv(512, 256), g = c.getContext('2d');
  const blobs = [];
  for (let i = 0; i < 9; i++) blobs.push([90 + rng() * 330, 150 - rng() * 70, 40 + rng() * 55]);
  const col = mixC(P.haze, '#ffffff', 0.55);
  for (const b of blobs) softEllipse(g, b[0], b[1] + 10, b[2] * 1.4, b[2] * 0.8, shadeC(P.skyTop, -0.05), 0.35);
  for (const b of blobs) {
    const rg = g.createRadialGradient(b[0] - b[2] * 0.3, b[1] - b[2] * 0.4, 2, b[0], b[1], b[2]);
    rg.addColorStop(0, col); rg.addColorStop(0.75, mixC(col, P.skyMid, 0.25)); rg.addColorStop(1, rgba(mixC(col, P.skyMid, 0.4), 0));
    g.fillStyle = rg; g.beginPath(); g.arc(b[0], b[1], b[2], 0, TAU); g.fill();
  }
  // flatten the base
  g.globalCompositeOperation = 'destination-out';
  const fg = g.createLinearGradient(0, 165, 0, 210);
  fg.addColorStop(0, 'rgba(0,0,0,0)'); fg.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = fg; g.fillRect(0, 160, 512, 96);
  return c;
}

// Tall far monuments. Painted in mid values; fog does the distance.
function paintMonument(seed, P, kind) {
  const rng = makeRng(seed);
  const W = 512, H = 1024;
  const c = cv(W, H), g = c.getContext('2d');
  const base = mixC(P.far, P.stone, 0.35);
  const cx = W / 2;
  if (kind === 'spire') {
    const bw = 120 + rng() * 40;
    polyPaint(g, [[cx - bw / 2, H], [cx - bw * 0.36, 300], [cx + bw * 0.36, 300], [cx + bw / 2, H]], base, rng, { streaks: 40, streakAng: -1.4 });
    for (let y = 360; y < H; y += 90 + rng() * 40) {
      const w = bw * (0.75 + (y / H) * 0.3);
      rectPaint(g, cx - w / 2 - 14, y, w + 28, 12, shadeC(base, 0.15), rng, { streaks: 2 });
      for (let k = 0; k < 3; k++) windowPaint(g, cx - w / 3 + k * w / 3 - 6, y + 30, 12, 22, P, rng, {});
    }
    // bulb crown with a strange little machine on top
    blobPaint(g, cx, 270, 78, shadeC(P.roof[0], 0.2), rng, { streaks: 12 });
    rectPaint(g, cx - 10, 120, 20, 90, shadeC(base, -0.1), rng, {});
    blobPaint(g, cx, 112, 28, shadeC(P.coral, 0.2), rng, {});
    g.strokeStyle = rgba(P.ink, 0.5); g.lineWidth = 3; g.beginPath(); g.moveTo(cx, 84); g.lineTo(cx, 30); g.stroke();
    g.fillStyle = P.coral; g.beginPath(); g.moveTo(cx, 30); g.lineTo(cx + 34, 40); g.lineTo(cx, 52); g.fill();
  } else if (kind === 'discs') {
    const coreW = 70 + rng() * 30;
    rectPaint(g, cx - coreW / 2, 120, coreW, H - 120, base, rng, { streaks: 30, streakAng: -1.4 });
    let y = 160;
    while (y < H - 60) {
      const dw = 180 + rng() * 140;
      const dh = 20 + rng() * 16;
      g.save(); g.beginPath(); g.ellipse(cx, y, dw / 2, dh, 0, 0, TAU); paintFill(g, shadeC(base, 0.12), rng, { x0: cx - dw / 2, x1: cx + dw / 2, y0: y - dh, y1: y + dh }); g.restore();
      if (rng.chance(0.5)) for (let k = 0; k < 4; k++) blobPaint(g, cx - dw / 2 + rng() * dw, y - dh * 0.6, 10 + rng() * 10, P.leaf, rng, { edge: false, streaks: 3 });
      if (rng.chance(0.5)) { rectPaint(g, cx + dw / 2 - 30, y - 60, 26, 50, shadeC(base, -0.05), rng, { streaks: 3 }); }
      y += 90 + rng() * 80;
    }
    blobPaint(g, cx, 120, 46, shadeC(P.roof[1], 0.2), rng, {});
  } else if (kind === 'mesa') {
    const pts = [[20, H], [40, 560], [90, 480], [180, 455], [300, 470], [420, 500], [470, 560], [490, H]];
    polyPaint(g, pts, mixC(base, P.leafDark, 0.15), rng, { j: 8, streaks: 50, streakAng: 1.3 });
    for (let i = 0; i < 9; i++) {
      const hx = 80 + rng() * 340, hw = 30 + rng() * 40, hh = 40 + rng() * 90;
      rectPaint(g, hx, 470 - hh, hw, hh + 20, shadeC(base, 0.1 + rng() * 0.1), rng, { streaks: 4 });
      polyPaint(g, [[hx - 6, 470 - hh], [hx + hw / 2, 470 - hh - 26], [hx + hw + 6, 470 - hh]], rng.pick(P.roof), rng, {});
    }
    for (let i = 0; i < 12; i++) blobPaint(g, 50 + rng() * 420, 480 + rng() * 40, 10 + rng() * 18, P.leaf, rng, { edge: false });
    // a waterfall spilling over the edge
    g.fillStyle = rgba(P.waterLight, 0.8); g.fillRect(380, 500, 14, H - 500);
    g.fillStyle = rgba('#ffffff', 0.5); g.fillRect(383, 500, 4, H - 500);
  } else if (kind === 'stair') {
    // a monumental stair-house climbing to nowhere in particular
    let x = 40, y = H - 20;
    for (let i = 0; i < 9; i++) {
      const w = 80 + rng() * 40, h = 60 + rng() * 30;
      rectPaint(g, x, y - h, w, h + (H - y), shadeC(base, (i % 2) * 0.08), rng, { streaks: 8 });
      if (rng.chance(0.6)) windowPaint(g, x + w / 2 - 8, y - h + 14, 16, 26, P, rng, {});
      x += w * 0.45; y -= h * 0.95;
      if (x > W - 140) x = 60;
    }
    blobPaint(g, x + 30, y - 40, 40, P.leaf, rng, {});
  }
  return c;
}

function paintFarWheel(seed, P) {
  const rng = makeRng(seed);
  const S = 512, c = cv(S, S), g = c.getContext('2d');
  const col = shadeC(mixC(P.far, P.wood, 0.3), -0.1);
  g.strokeStyle = col; g.lineCap = 'round';
  g.lineWidth = 14; g.beginPath(); g.arc(S / 2, S / 2, S * 0.44, 0, TAU); g.stroke();
  g.lineWidth = 6; g.beginPath(); g.arc(S / 2, S / 2, S * 0.38, 0, TAU); g.stroke();
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; g.lineWidth = 5; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.cos(a) * S * 0.44, S / 2 + Math.sin(a) * S * 0.44); g.stroke(); }
  for (let i = 0; i < 16; i++) { const a = i / 16 * TAU; rectPaint(g, S / 2 + Math.cos(a) * S * 0.44 - 12, S / 2 + Math.sin(a) * S * 0.44 - 10, 24, 20, shadeC(col, 0.2), rng, { streaks: 0 }); }
  blobPaint(g, S / 2, S / 2, 30, shadeC(col, 0.1), rng, {});
  return c;
}

// Horizontal tileable strip of hills, terraces, towns.
function paintRidge(seed, P, kind) {
  const rng = makeRng(seed);
  const W = 2048, H = 512, c = cv(W, H), g = c.getContext('2d');
  const base = kind === 'far' ? mixC(P.mid, P.far, 0.5) : P.mid;
  const pts = [];
  const N = 32;
  const hs = [];
  for (let i = 0; i <= N; i++) hs.push(140 + Math.sin(i / N * TAU * 2) * 40 + Math.sin(i / N * TAU * 5 + 1) * 25 + (rng() - 0.5) * 30);
  hs[N] = hs[0];
  for (let i = 0; i <= N; i++) pts.push([i / N * W, hs[i]]);
  g.beginPath(); g.moveTo(0, H);
  for (const p of pts) g.lineTo(p[0], p[1]);
  g.lineTo(W, H); g.closePath();
  paintFill(g, base, rng, { streaks: 120, streakLen: 60, streakAng: 0.1, edge: false });
  const hAt = x => { const f = (x / W) * N; const i = Math.floor(f) % N; return lerp(hs[i], hs[i + 1], f - Math.floor(f)); };
  // terraces
  for (let k = 0; k < 5; k++) {
    g.strokeStyle = rgba(shadeC(base, 0.25), 0.4); g.lineWidth = 3;
    g.beginPath();
    for (let x = 0; x <= W; x += 16) { const y = hAt(x) + 40 + k * 55 + Math.sin(x * 0.01 + k) * 6; x ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke();
  }
  const draw = (fn) => { fn(0); };
  // towns and trees (wrapping at the seam)
  for (let i = 0; i < 70; i++) {
    const x = rng() * W, y = hAt(x);
    const type = rng();
    for (const off of [0, -W, W]) {
      const X = x + off;
      if (X < -100 || X > W + 100) continue;
      const r2 = makeRng(seed * 7 + i);
      if (type < 0.45) {
        blobPaint(g, X, y + 4, 10 + r2() * 14, r2.chance(0.5) ? P.leaf : P.leafDark, r2, { edge: false, streaks: 3 });
      } else if (type < 0.85) {
        const w = 18 + r2() * 26, h = 20 + r2() * 40;
        rectPaint(g, X - w / 2, y - h + 8, w, h + 30, shadeC(mixC(base, P.stone, 0.6), r2() * 0.2), r2, { streaks: 3, edgeW: 1 });
        polyPaint(g, [[X - w / 2 - 4, y - h + 8], [X, y - h - 12], [X + w / 2 + 4, y - h + 8]], mixC(r2.pick(P.roof), base, 0.3), r2, { streaks: 1 });
        if (r2.chance(0.6)) { g.fillStyle = rgba(P.ink, 0.45); g.fillRect(X - 3, y - h + 20, 5, 7); }
      } else {
        const h = 60 + r2() * 70;
        rectPaint(g, X - 7, y - h, 14, h + 20, shadeC(mixC(base, P.stone, 0.5), 0.1), r2, { streaks: 3 });
        blobPaint(g, X, y - h, 12, mixC(r2.pick(P.roof), base, 0.2), r2, {});
      }
    }
  }
  void draw;
  return c;
}

// Mist band (soft, horizontally tileable).
function paintMist(seed, P) {
  const rng = makeRng(seed);
  const W = 1024, H = 256, c = cv(W, H), g = c.getContext('2d');
  const col = mixC(P.haze, '#ffffff', 0.4);
  for (let i = 0; i < 40; i++) {
    const x = rng() * W, y = 90 + rng() * 120, r = 50 + rng() * 90;
    for (const off of [0, -W, W]) softEllipse(g, x + off, y, r * 1.6, r * 0.6, col, 0.35);
  }
  const lg = g.createLinearGradient(0, 0, 0, H);
  lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(0.45, rgba(col, 0.55)); lg.addColorStop(1, rgba(col, 0.95));
  g.fillStyle = lg; g.fillRect(0, 0, W, H);
  return c;
}

// Near-background building with windows, shutters, plants and little people.
function paintHouse(seed, P, opts) {
  const rng = makeRng(seed);
  const W = 256, H = 640, c = cv(W, H), g = c.getContext('2d');
  const wall = jitterC(mixC(P.stone, P.near, 0.4), rng, 0.12);
  const w = 120 + rng() * 80, x0 = (W - w) / 2, top = 120 + rng() * 120;
  rectPaint(g, x0, top, w, H - top, wall, rng, { streaks: 40, streakAng: -1.35 });
  // floor bands
  for (let y = top + 70; y < H; y += 95 + rng() * 20) rectPaint(g, x0 - 6, y, w + 12, 9, shadeC(wall, 0.18), rng, { streaks: 1, edgeW: 1 });
  // windows
  const cols = w > 160 ? 3 : 2;
  for (let y = top + 22; y < H - 60; y += 95 + rng() * 10) {
    for (let k = 0; k < cols; k++) {
      if (rng.chance(0.2)) continue;
      const wx = x0 + (k + 0.5) * w / cols - 9;
      windowPaint(g, wx, y, 18, 30, P, rng, { shutters: rng.chance(0.4), plant: rng.chance(0.3), figure: rng.chance(0.12), lit: opts && opts.lit && rng.chance(0.35) });
    }
  }
  // roof
  const rk = rng();
  const rc = rng.pick(P.roof);
  if (rk < 0.4) polyPaint(g, [[x0 - 14, top + 4], [x0 + w / 2, top - 70 - rng() * 40], [x0 + w + 14, top + 4]], rc, rng, { streaks: 20, streakAng: 0.8 });
  else if (rk < 0.7) { g.beginPath(); g.ellipse(x0 + w / 2, top + 4, w / 2 + 10, 60 + rng() * 30, 0, Math.PI, 0); paintFill(g, rc, rng, { x0, x1: x0 + w, y0: top - 90, y1: top }); blobPaint(g, x0 + w / 2, top - 70, 10, P.yellow, rng, {}); }
  else {
    rectPaint(g, x0 - 8, top - 10, w + 16, 14, shadeC(wall, 0.15), rng, {});
    // roof garden
    for (let i = 0; i < 8; i++) blobPaint(g, x0 + rng() * w, top - 14 - rng() * 20, 10 + rng() * 14, rng.chance(0.2) ? P.coral : P.leaf, rng, { edge: false });
  }
  // chimney or odd contraption
  if (rng.chance(0.5)) {
    const cx = x0 + w * (0.2 + rng() * 0.6);
    rectPaint(g, cx - 8, top - 80, 16, 70, shadeC(wall, -0.1), rng, {});
    g.strokeStyle = rgba(P.ink, 0.5); g.lineWidth = 2;
    g.beginPath(); g.moveTo(cx, top - 80); g.lineTo(cx + 26, top - 110); g.stroke();
    blobPaint(g, cx + 26, top - 112, 7, P.coral, rng, {});
  }
  // a door at street level
  rectPaint(g, x0 + w / 2 - 14, H - 70, 28, 70, rng.pick(P.shutter), rng, {});
  // climbing ivy
  if (rng.chance(0.6)) {
    const vx = rng.chance(0.5) ? x0 + 6 : x0 + w - 6;
    for (let y = H; y > top + rng() * 200; y -= 8) blobPaint(g, vx + (rng() - 0.5) * 18, y, 5 + rng() * 6, rng.chance(0.5) ? P.leaf : P.leafDark, rng, { edge: false, streaks: 0 });
  }
  return c;
}

function paintTree(seed, P) {
  const rng = makeRng(seed);
  const c = cv(256, 320), g = c.getContext('2d');
  polyPaint(g, [[118, 320], [124, 180], [132, 180], [140, 320]], P.woodDark, rng, {});
  const cols = [P.leafDark, P.leaf, shadeC(P.leaf, 0.2)];
  for (let layer = 0; layer < 3; layer++) for (let i = 0; i < 9; i++) {
    const a = rng() * TAU, r = rng() * 60;
    blobPaint(g, 128 + Math.cos(a) * r * 1.2, 140 + Math.sin(a) * r * 0.8 - layer * 10, 30 + rng() * 22 - layer * 6, cols[layer], rng, { edge: layer === 0 ? 0.2 : false, streaks: 4 });
  }
  if (rng.chance(0.5)) for (let i = 0; i < 7; i++) blobPaint(g, 70 + rng() * 116, 90 + rng() * 100, 5, P.coral, rng, { edge: false, streaks: 0 });
  return c;
}

// Tileable stone face for piers.
function paintStoneTile(seed, P, style) {
  const rng = makeRng(seed);
  const S = 256, c = cv(S, S), g = c.getContext('2d');
  const base = style === 'wood' ? P.wood : P.stone;
  g.fillStyle = shadeC(base, -0.2); g.fillRect(0, 0, S, S);
  if (style === 'wood') {
    for (let x = 0; x < S; x += 32) rectPaint(g, x + 1, 0, 30, S, jitterC(base, rng, 0.12), rng, { streakAng: 1.57, streaks: 12, edgeW: 1.2 });
  } else {
    const rows = 4;
    for (let r = 0; r < rows; r++) {
      const y = r * S / rows, h = S / rows;
      let x = (r % 2) * -40;
      while (x < S) {
        const w = 60 + rng() * 50;
        for (const off of [0, S]) if (x + off < S + 1 && x + w + off > -1) rectPaint(g, x + 2 + off - (off ? S : 0), y + 2, w - 4, h - 4, jitterC(base, rng, 0.1), rng, { streaks: 6, edgeW: 1.2, j: 1.5 });
        x += w;
      }
    }
    for (let i = 0; i < 10; i++) blobPaint(g, rng() * S, rng() * S, 4 + rng() * 7, rgba(P.moss, 0.5), rng, { edge: false, streaks: 0 });
  }
  return c;
}

// A ring you can hold: always the same dusty coral, so you learn to read it.
function paintRing(P) {
  const c = cv(128, 128), g = c.getContext('2d');
  const rng = makeRng(5);
  softEllipse(g, 64, 64, 60, 60, '#fff3d0', 0.35);
  g.lineWidth = 15; g.strokeStyle = shadeC(P.coral, -0.35); g.beginPath(); g.arc(64, 66, 36, 0, TAU); g.stroke();
  g.lineWidth = 12; g.strokeStyle = P.coral; g.beginPath(); g.arc(64, 64, 36, 0, TAU); g.stroke();
  g.lineWidth = 3; g.strokeStyle = shadeC(P.coral, 0.45); g.beginPath(); g.arc(64, 64, 38, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
  void rng;
  return c;
}

function paintLetter(P) {
  const c = cv(128, 128), g = c.getContext('2d');
  const rng = makeRng(9);
  softEllipse(g, 64, 64, 62, 62, '#fff2c0', 0.55);
  g.save(); g.translate(64, 64); g.rotate(-0.12);
  polyPaint(g, [[-34, -22], [34, -22], [34, 22], [-34, 22]], '#f6ecd6', rng, { streaks: 4, edge: 0.45 });
  g.strokeStyle = rgba('#8a7a62', 0.8); g.lineWidth = 2.2; g.beginPath(); g.moveTo(-34, -22); g.lineTo(0, 4); g.lineTo(34, -22); g.stroke();
  blobPaint(g, 0, 4, 7, P.coral, rng, {});
  g.restore();
  return c;
}

function paintSoftDot(color) {
  const c = cv(64, 64), g = c.getContext('2d');
  softEllipse(g, 32, 32, 30, 30, color, 0.9);
  return c;
}
