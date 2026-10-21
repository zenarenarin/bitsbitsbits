// =====================================================================
// The illustrated city. Every façade exists twice: as ink (the city at
// night) and as an engraving on paper (the city where the Watcher's light
// falls). The renderer draws the ink version, then the paper version
// clipped to the lamps' visibility polygons, so light reveals the
// engraving and shadow is the city's own black.
//
// Palette: ink #0d0d0c, night #1c1b19, stone line #3a3833, ambient glass
// #5f5b53 (grey: ordinary light is never white), paper #ece7dc. Only the
// Watcher's light is white.
// =====================================================================
const INK = '#0d0d0c', NIGHT = '#1c1b19', PAPER = '#ece7dc', PAPER2 = '#d9d3c6', STONE = '#3a3833', GLASS = '#47443e';

function facadeRoofH(f) { return f.style === 'gable' ? 3.6 : f.style === 'tall' ? 2.8 : f.style === 'narrow' ? 2.2 : f.style === 'gate' ? 1.4 : 0.9; }

// Draw one façade into a 2D context whose transform maps world metres
// (origin at the façade's bottom-left, y down from the roof) to pixels.
// `lit` chooses the engraving palette.
function drawFacade(g, f, s, lit) {
  const R = rng(f.seed), w = f.x1 - f.x0, H = f.h;
  const base = lit ? PAPER : NIGHT, line = lit ? 'rgba(26,24,21,0.62)' : STONE, deep = lit ? 'rgba(20,18,16,0.9)' : '#121110';
  const roofH = facadeRoofH(f);
  const Y = y => (H + roofH - y) * s; // world y (from street) to canvas y
  const X = x => x * s;
  g.lineCap = 'butt';
  // body
  g.fillStyle = base;
  g.fillRect(0, Y(H), X(w), H * s + 1);
  // roof silhouette
  g.beginPath();
  if (f.style === 'gable') { g.moveTo(X(-0.2), Y(H)); g.lineTo(X(w * 0.48), Y(H + roofH)); g.lineTo(X(w * 0.56), Y(H + roofH - 0.2)); g.lineTo(X(w + 0.2), Y(H)); }
  else if (f.style === 'tall') { g.moveTo(X(-0.1), Y(H)); g.lineTo(X(0.9), Y(H + roofH)); g.lineTo(X(w - 1.4), Y(H + roofH + 0.3)); g.lineTo(X(w + 0.1), Y(H)); }
  else if (f.style === 'narrow') { g.moveTo(X(0), Y(H)); g.lineTo(X(w * 0.3), Y(H + roofH)); g.lineTo(X(w * 0.38), Y(H + roofH + 0.6)); g.lineTo(X(w * 0.44), Y(H + roofH)); g.lineTo(X(w), Y(H + 0.4)); g.lineTo(X(w), Y(H)); }
  else { g.moveTo(X(0), Y(H)); g.lineTo(X(0), Y(H + roofH * 0.5)); g.lineTo(X(w), Y(H + roofH * 0.62)); g.lineTo(X(w), Y(H)); }
  g.closePath(); g.fillStyle = lit ? PAPER2 : '#151413'; g.fill();
  // roof tiles: slanted hatching
  g.save(); g.clip();
  g.strokeStyle = line; g.lineWidth = Math.max(0.6, s * 0.02);
  for (let x = -roofH * 2; x < w + roofH * 2; x += 0.22) { g.beginPath(); g.moveTo(X(x), Y(H)); g.lineTo(X(x + roofH * 0.7), Y(H + roofH + 1)); g.stroke(); }
  g.restore();
  // decorative chimney pots on pitched roofs, leaning a little (Caligari)
  if (f.style !== 'long' && f.style !== 'terrace' && f.style !== 'court') {
    const n = R.int(1, 2);
    for (let i = 0; i < n; i++) {
      const cx = R.range(0.15, 0.8) * w, lean = R.range(-0.12, 0.12), ch = R.range(1.6, 2.6);
      const by = f.style === 'gable' ? H + roofH * (1 - Math.abs(cx / w - 0.5) * 2) - 0.3 : H + roofH * 0.5;
      g.fillStyle = lit ? '#cfc8b9' : '#141312';
      g.beginPath(); g.moveTo(X(cx - 0.35), Y(by - 0.4)); g.lineTo(X(cx - 0.3 + lean * ch), Y(by + ch)); g.lineTo(X(cx + 0.3 + lean * ch), Y(by + ch)); g.lineTo(X(cx + 0.35), Y(by - 0.4)); g.fill();
      g.strokeStyle = line; g.lineWidth = Math.max(0.6, s * 0.025);
      for (let y = by; y < by + ch; y += 0.25) { g.beginPath(); g.moveTo(X(cx - 0.32 + lean * (y - by)), Y(y)); g.lineTo(X(cx + 0.32 + lean * (y - by)), Y(y)); g.stroke(); }
    }
  }
  // ashlar courses
  g.strokeStyle = line; g.lineWidth = Math.max(0.5, s * 0.018);
  const course = 0.36;
  for (let y = course; y < H; y += course) {
    g.globalAlpha = lit ? 0.42 : 0.55;
    g.beginPath(); g.moveTo(0, Y(y)); g.lineTo(X(w), Y(y)); g.stroke();
    const off = R.range(0, 1.1);
    g.beginPath();
    for (let x = off; x < w; x += R.range(0.8, 1.4)) { g.moveTo(X(x), Y(y)); g.lineTo(X(x), Y(y - course)); }
    g.stroke();
  }
  g.globalAlpha = 1;
  // storeys: cornice bands and windows
  const storey = 3, bays = Math.max(1, Math.round(w / 2.3)), bw = w / bays;
  const shear = R.range(-0.05, 0.05);
  for (let k = 0; k * storey + 0.2 < H - 1.2; k++) {
    const y0 = k * storey;
    // cornice band with dentils and the shade beneath it
    if (k > 0) {
      g.fillStyle = lit ? '#c9c2b2' : '#262522';
      g.fillRect(0, Y(y0 + 0.22), X(w), 0.22 * s);
      g.fillStyle = deep;
      for (let x = 0.1; x < w; x += 0.32) g.fillRect(X(x), Y(y0), 0.14 * s, 0.1 * s);
      g.strokeStyle = line; g.lineWidth = Math.max(0.5, s * 0.016);
      for (let i = 0; i < 5; i++) { g.globalAlpha = (lit ? 0.5 : 0.7) * (1 - i / 5); g.beginPath(); g.moveTo(0, Y(y0 - 0.06 - i * 0.07)); g.lineTo(X(w), Y(y0 - 0.06 - i * 0.07)); g.stroke(); }
      g.globalAlpha = 1;
    }
    const shop = (f.style === 'shop' || f.style === 'terrace') && k === 0;
    if (f.style === 'gate' && k === 0) continue;
    for (let b = 0; b < bays; b++) {
      const cx = (b + 0.5) * bw;
      if (k === 0 && !shop && R.chance(0.35)) {
        // a door
        const dw = 1.1, dh = 2.3;
        drawOpening(g, X, Y, cx - dw / 2, y0, dw, dh, true, lit, line, deep, R, 0);
        continue;
      }
      const ww = shop ? Math.min(bw - 0.5, 2.0) : R.range(0.85, 1.1), wh = shop ? 2.1 : R.range(1.6, 2.0);
      const wy = y0 + (shop ? 0.5 : 0.75);
      if (wy + wh > H - 0.4) continue;
      drawOpening(g, X, Y, cx - ww / 2, wy, ww, wh, false, lit, line, deep, R, shear, shop);
    }
  }
  // quoins at the corners
  g.fillStyle = lit ? '#d2cbbd' : '#232220';
  for (let y = 0; y < H - 0.3; y += 0.6) { g.fillRect(0, Y(y + 0.55), (y / 0.6) % 2 ? 0.35 * s : 0.55 * s, 0.5 * s); g.fillRect(X(w) - ((y / 0.6) % 2 ? 0.35 : 0.55) * s, Y(y + 0.55), ((y / 0.6) % 2 ? 0.35 : 0.55) * s, 0.5 * s); }
  // soot: vertical streaks of weathering
  g.strokeStyle = lit ? 'rgba(30,28,24,0.18)' : 'rgba(0,0,0,0.25)';
  for (let i = 0; i < w * 1.4; i++) { const x = R.range(0, w); g.lineWidth = R.range(0.5, 2); g.beginPath(); g.moveTo(X(x), Y(R.range(H * 0.4, H))); g.lineTo(X(x + R.range(-0.05, 0.05)), Y(R.range(0, H * 0.4))); g.stroke(); }
  // eaves line
  g.fillStyle = lit ? INK : '#0b0b0a';
  g.fillRect(-1, Y(H) - 1, X(w) + 2, Math.max(2, 0.12 * s));
  // gate: the arch of the passage
  if (f.style === 'gate') {
    g.fillStyle = deep;
    g.beginPath(); g.moveTo(X(w * 0.12), Y(0)); g.lineTo(X(w * 0.12), Y(3.4)); g.quadraticCurveTo(X(w * 0.5), Y(6.4), X(w * 0.88), Y(3.4)); g.lineTo(X(w * 0.88), Y(0)); g.fill();
    g.strokeStyle = line; g.lineWidth = Math.max(0.6, s * 0.03);
    for (let i = 0; i < 9; i++) { const t = i / 8, ax = lerp(w * 0.12, w * 0.88, t); g.beginPath(); g.moveTo(X(ax), Y(3.4 + Math.sin(t * Math.PI) * 3)); g.lineTo(X(lerp(w * 0.04, w * 0.96, t)), Y(3.9 + Math.sin(t * Math.PI) * 3.4)); g.stroke(); }
  }
}

function drawOpening(g, X, Y, x, y, w, h, door, lit, line, deep, R, shear, shop) {
  const arched = !shop && R.chance(0.5);
  const sh = shear * h;
  const path = () => {
    g.beginPath();
    g.moveTo(X(x), Y(y)); g.lineTo(X(x + w), Y(y));
    if (arched) { g.lineTo(X(x + w + sh), Y(y + h - w / 2)); g.arc(X(x + w / 2 + sh), Y(y + h - w / 2), (w / 2) * (X(1) - X(0)), 0, Math.PI, true); }
    else { g.lineTo(X(x + w + sh), Y(y + h)); g.lineTo(X(x + sh), Y(y + h)); }
    g.closePath();
  };
  // frame
  g.fillStyle = lit ? '#cdc5b5' : '#2d2b28';
  g.fillRect(X(x - 0.12), Y(y + h + 0.18), (w + 0.24) * (X(1) - X(0)), (h + 0.2) * (X(1) - X(0)));
  // ordinary lamplight in some rooms: grey, never white
  const warm = !door && !lit && R.chance(shop ? 0.4 : 0.13);
  path(); g.fillStyle = door ? deep : warm ? GLASS : lit ? '#2a2723' : '#0c0c0b'; g.fill();
  const S = X(1) - X(0);
  g.save(); path(); g.clip();
  if (door) {
    g.strokeStyle = line; g.lineWidth = Math.max(0.5, S * 0.02);
    for (let i = 1; i < 4; i++) { g.beginPath(); g.moveTo(X(x + w * i / 4), Y(y)); g.lineTo(X(x + w * i / 4), Y(y + h)); g.stroke(); }
  } else {
    // glazing bars
    g.strokeStyle = lit ? 'rgba(236,231,220,0.55)' : warm ? '#3e3b35' : '#22211f';
    g.lineWidth = Math.max(0.6, S * 0.035);
    g.beginPath(); g.moveTo(X(x + w / 2 + sh / 2), Y(y)); g.lineTo(X(x + w / 2 + sh / 2), Y(y + h)); g.stroke();
    for (let i = 1; i < 3; i++) { g.beginPath(); g.moveTo(X(x), Y(y + h * i / 3)); g.lineTo(X(x + w + sh), Y(y + h * i / 3)); g.stroke(); }
    if (warm) { g.fillStyle = 'rgba(20,19,17,0.8)'; g.fillRect(X(x + w * R.range(0.1, 0.5)), Y(y + h * 0.75), w * 0.35 * S, h * 0.75 * S); }
  }
  g.restore();
  // shutters, folded open beside the window, with louvres
  if (!door && !shop && R.chance(0.6)) {
    const sw = w * 0.5;
    for (const side of [-1, 1]) {
      const sx = side < 0 ? x - sw - 0.08 : x + w + 0.08;
      g.fillStyle = lit ? '#bdb5a4' : '#232220';
      g.fillRect(X(sx), Y(y + h), sw * S, h * S);
      g.strokeStyle = lit ? 'rgba(20,18,16,0.6)' : '#141312'; g.lineWidth = Math.max(0.5, S * 0.02);
      for (let yy = y + 0.12; yy < y + h; yy += 0.13) { g.beginPath(); g.moveTo(X(sx), Y(yy)); g.lineTo(X(sx + sw), Y(yy)); g.stroke(); }
    }
  }
  // sill
  g.fillStyle = lit ? INK : '#0a0a09';
  g.fillRect(X(x - 0.18), Y(y) - 1, (w + 0.36) * S, Math.max(2, 0.1 * S));
}

// Distant city: Caligari's leaning towers, cut from grey card.
function makeSkyline(seed, x0, x1, par) {
  const R = rng(seed), out = [];
  let x = x0;
  while (x < x1) {
    const w = R.range(2.5, 6.5), h = R.range(9, 26) * (par < 0.5 ? 1.15 : 0.85), lean = R.range(-0.18, 0.18);
    const kind = R.pick(['spire', 'block', 'gable', 'block', 'tower', 'crane']);
    const win = [];
    for (let i = 0; i < R.int(0, 5); i++) win.push({ x: R.range(0.2, 0.8), y: R.range(0.2, 0.8), on: R.chance(0.6), k: R.range(0, 1) });
    out.push({ x, w, h, lean, kind, win, seed: R.int(1, 1e6) });
    x += w * R.range(0.55, 1.05);
  }
  return out;
}
