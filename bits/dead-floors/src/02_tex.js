// Procedural textures: grimy institutional concrete, tiles, steel, skin, cloth and blood.
const TEX = {};
// One hidden SDK-managed canvas is reused to paint every texture; each result is copied
// into a DataTexture before the next one is painted.
let scratch = null;
function cnv(w, h) {
  if (!scratch) {
    scratch = ctx.createCanvas2D({ layer: 'background', order: -10, input: 'passthrough', willReadFrequently: true });
    scratch.style.display = 'none';
  }
  scratch.width = w; scratch.height = h;
  const g = scratch.getContext('2d', { willReadFrequently: true });
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  g.clearRect(0, 0, w, h);
  return scratch;
}
function grain(g, w, h, amp, R, mono = true) {
  const id = g.getImageData(0, 0, w, h), d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (R() - 0.5) * amp;
    if (mono) { d[i] = clamp(d[i] + n, 0, 255); d[i + 1] = clamp(d[i + 1] + n, 0, 255); d[i + 2] = clamp(d[i + 2] + n, 0, 255); }
    else { d[i] = clamp(d[i] + (R() - 0.5) * amp, 0, 255); d[i + 1] = clamp(d[i + 1] + (R() - 0.5) * amp, 0, 255); d[i + 2] = clamp(d[i + 2] + (R() - 0.5) * amp, 0, 255); }
  }
  g.putImageData(id, 0, 0);
}
function blotch(g, x, y, r, color, a) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, color.replace('A', a)); gr.addColorStop(1, color.replace('A', 0));
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
}
function blotches(g, w, h, R, n, color, rmin, rmax, amin, amax) {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, r = rmin + R() * (rmax - rmin), a = amin + R() * (amax - amin);
    // wrap so tiling stays seamless
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) if (x + ox + r > 0 && x + ox - r < w && y + oy + r > 0 && y + oy - r < h) blotch(g, x + ox, y + oy, r, color, a);
  }
}
function crack(g, x, y, len, R, color = 'rgba(20,18,15,0.55)') {
  g.strokeStyle = color; g.lineWidth = 1 + R(); g.beginPath(); g.moveTo(x, y);
  let a = R() * TAU;
  for (let i = 0; i < len; i++) { a += (R() - 0.5) * 0.9; x += Math.cos(a) * 6; y += Math.sin(a) * 6; g.lineTo(x, y); }
  g.stroke();
}
function mkTex(c, srgb = true, rep = true) {
  const w = c.width, h = c.height;
  const src = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;
  const data = new Uint8Array(w * h * 4), row = w * 4;
  for (let y = 0; y < h; y++) data.set(src.subarray((h - 1 - y) * row, (h - y) * row), y * row);
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.wrapS = t.wrapT = rep ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
  t.needsUpdate = true;
  return t;
}

function buildTextures() {
  const R = mulberry32(1337);
  // Floor: worn vinyl tiles over concrete, stains, cracks.
  {
    const S = 512, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#5b574e'; g.fillRect(0, 0, S, S);
    const n = 4, ts = S / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = 80 + R() * 22; g.fillStyle = `rgb(${v + 4},${v},${v - 8})`;
      g.fillRect(i * ts + 1, j * ts + 1, ts - 2, ts - 2);
      if (R() < 0.18) { g.fillStyle = 'rgba(40,36,30,0.55)'; g.fillRect(i * ts + 1 + R() * 30, j * ts + 1 + R() * 30, ts * (0.3 + R() * 0.5), ts * (0.3 + R() * 0.5)); }
    }
    g.strokeStyle = 'rgba(25,22,18,0.8)'; g.lineWidth = 2;
    for (let i = 0; i <= n; i++) { g.beginPath(); g.moveTo(i * ts, 0); g.lineTo(i * ts, S); g.stroke(); g.beginPath(); g.moveTo(0, i * ts); g.lineTo(S, i * ts); g.stroke(); }
    blotches(g, S, S, R, 26, 'rgba(38,30,20,A)', 20, 90, 0.15, 0.4);
    blotches(g, S, S, R, 6, 'rgba(70,18,14,A)', 10, 40, 0.15, 0.35);
    for (let i = 0; i < 9; i++) crack(g, R() * S, R() * S, 8 + R() * 18, R);
    grain(g, S, S, 26, R);
    TEX.floor = mkTex(c);
    // Roughness map: puddles read as glossy under the flashlight.
    const r = cnv(256, 256), rg = r.getContext('2d');
    rg.fillStyle = '#d0d0d0'; rg.fillRect(0, 0, 256, 256);
    blotches(rg, 256, 256, R, 7, 'rgba(30,30,30,A)', 18, 55, 0.6, 0.95);
    grain(rg, 256, 256, 40, R);
    TEX.floorRough = mkTex(r, false);
  }
  // Walls: two-tone institutional paint, grime drips, scuffs. Covers two cells wide.
  {
    const W = 1024, H = 512, c = cnv(W, H), g = c.getContext('2d');
    const split = H * 0.62;
    let gr = g.createLinearGradient(0, 0, 0, split);
    gr.addColorStop(0, '#6f6a5c'); gr.addColorStop(1, '#8b8676');
    g.fillStyle = gr; g.fillRect(0, 0, W, split);
    gr = g.createLinearGradient(0, split, 0, H);
    gr.addColorStop(0, '#3e4a41'); gr.addColorStop(1, '#2c342e');
    g.fillStyle = gr; g.fillRect(0, split, W, H - split);
    g.fillStyle = '#24261f'; g.fillRect(0, split - 5, W, 9);
    g.fillStyle = '#1b1c18'; g.fillRect(0, H - 22, W, 22);
    for (let i = 0; i < 70; i++) {
      const x = R() * W, w = 2 + R() * 14, len = 30 + R() * 260, a = 0.05 + R() * 0.18;
      const d = g.createLinearGradient(0, 0, 0, len);
      d.addColorStop(0, `rgba(45,38,25,${a})`); d.addColorStop(1, 'rgba(45,38,25,0)');
      g.fillStyle = d; g.fillRect(x, 0, w, len);
    }
    blotches(g, W, H, R, 16, 'rgba(70,58,35,A)', 30, 120, 0.1, 0.3);
    blotches(g, W, H, R, 10, 'rgba(20,20,16,A)', 20, 80, 0.15, 0.35);
    g.strokeStyle = 'rgba(30,28,22,0.35)';
    for (let i = 0; i < 40; i++) { g.lineWidth = 0.5 + R() * 1.5; const x = R() * W, y = split - 80 + R() * 200; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (R() - 0.5) * 120, y + (R() - 0.5) * 20); g.stroke(); }
    for (let i = 0; i < 6; i++) crack(g, R() * W, R() * split, 6 + R() * 14, R, 'rgba(25,22,18,0.5)');
    grain(g, W, H, 22, R);
    TEX.wall = mkTex(c);
  }
  // Ceiling: acoustic tiles with water rings.
  {
    const S = 512, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#9a968a'; g.fillRect(0, 0, S, S);
    const n = 2, ts = S / n;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const v = 128 + R() * 18; g.fillStyle = `rgb(${v},${v - 3},${v - 10})`; g.fillRect(i * ts + 4, j * ts + 4, ts - 8, ts - 8); }
    g.fillStyle = '#4a4a46'; for (let i = 0; i <= n; i++) { g.fillRect(i * ts - 4, 0, 8, S); g.fillRect(0, i * ts - 4, S, 8); }
    for (let i = 0; i < 6; i++) { const x = R() * S, y = R() * S, r = 20 + R() * 60; g.strokeStyle = 'rgba(90,70,40,0.35)'; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, TAU); g.stroke(); blotch(g, x, y, r, 'rgba(110,90,55,A)', 0.25); }
    grain(g, S, S, 30, R);
    TEX.ceil = mkTex(c);
  }
  // Brushed steel for elevators, doors, props.
  {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#8a8d90'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y++) { g.fillStyle = `rgba(${R() < 0.5 ? 255 : 0},${R() < 0.5 ? 255 : 0},255,${R() * 0.05})`; g.fillRect(0, y, S, 1); }
    blotches(g, S, S, R, 8, 'rgba(60,45,30,A)', 10, 40, 0.1, 0.3);
    grain(g, S, S, 14, R);
    TEX.steel = mkTex(c);
  }
  // Wooden crate planks.
  {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#6e5233'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 4; i++) { const v = 90 + R() * 30; g.fillStyle = `rgb(${v + 20},${v - 5},${v - 40})`; g.fillRect(4, i * 64 + 3, S - 8, 58); }
    g.strokeStyle = 'rgba(40,25,10,0.35)'; for (let i = 0; i < 60; i++) { g.lineWidth = 1; const y = R() * S; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(80, y + R() * 6, 160, y - R() * 6, S, y); g.stroke(); }
    g.fillStyle = '#3d2b18'; g.fillRect(0, 0, 14, S); g.fillRect(S - 14, 0, 14, S); g.fillRect(0, 0, S, 10); g.fillRect(0, S - 10, S, 10);
    grain(g, S, S, 20, R);
    TEX.crate = mkTex(c);
  }
  // Rusty painted barrel.
  {
    const W = 256, H = 128, c = cnv(W, H), g = c.getContext('2d');
    g.fillStyle = '#5a2a1e'; g.fillRect(0, 0, W, H);
    blotches(g, W, H, R, 30, 'rgba(120,60,25,A)', 6, 26, 0.3, 0.7);
    blotches(g, W, H, R, 10, 'rgba(30,20,15,A)', 8, 30, 0.3, 0.6);
    g.fillStyle = 'rgba(20,15,10,0.7)'; g.fillRect(0, 30, W, 6); g.fillRect(0, 92, W, 6);
    g.fillStyle = 'rgba(210,170,40,0.75)'; g.fillRect(90, 46, 76, 36);
    g.fillStyle = 'rgba(20,15,10,0.9)'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.fillText('☢', 128, 74);
    grain(g, W, H, 24, R);
    TEX.barrel = mkTex(c);
  }
  // Ammo box and medkit.
  {
    const c = cnv(256, 128), g = c.getContext('2d');
    g.fillStyle = '#4b5531'; g.fillRect(0, 0, 256, 128);
    g.fillStyle = '#3a4226'; g.fillRect(0, 0, 256, 14); g.fillRect(0, 114, 256, 14);
    g.fillStyle = '#d9c25a'; g.font = 'bold 40px sans-serif'; g.textAlign = 'center'; g.fillText('AMMO', 128, 80);
    grain(g, 256, 128, 18, R);
    TEX.ammo = mkTex(c, true, false);
    const m = cnv(256, 128), mg = m.getContext('2d');
    mg.fillStyle = '#e8e4da'; mg.fillRect(0, 0, 256, 128);
    mg.fillStyle = '#c3221c'; mg.fillRect(110, 24, 36, 80); mg.fillRect(88, 46, 80, 36);
    grain(mg, 256, 128, 14, R);
    TEX.med = mkTex(m, true, false);
  }
  // Zombie skin: mottled grey-green with bruising, veins and dried blood.
  {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#9aa08a'; g.fillRect(0, 0, S, S);
    blotches(g, S, S, R, 40, 'rgba(70,80,55,A)', 8, 34, 0.3, 0.6);
    blotches(g, S, S, R, 16, 'rgba(90,50,70,A)', 6, 24, 0.25, 0.55);
    blotches(g, S, S, R, 12, 'rgba(90,15,10,A)', 4, 20, 0.4, 0.8);
    g.strokeStyle = 'rgba(70,40,80,0.35)'; for (let i = 0; i < 20; i++) crack(g, R() * S, R() * S, 4 + R() * 6, R, 'rgba(70,40,85,0.3)');
    grain(g, S, S, 30, R);
    TEX.skin = mkTex(c);
  }
  // Clothes: dirty fabric weave with blood soak (tinted by material colour).
  {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    g.fillStyle = '#d8d8d4'; g.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y += 3) { g.fillStyle = `rgba(0,0,0,${0.04 + R() * 0.05})`; g.fillRect(0, y, S, 1); }
    blotches(g, S, S, R, 18, 'rgba(70,55,40,A)', 10, 40, 0.25, 0.5);
    blotches(g, S, S, R, 9, 'rgba(110,10,8,A)', 10, 46, 0.45, 0.85);
    g.strokeStyle = 'rgba(20,15,10,0.6)'; for (let i = 0; i < 8; i++) { g.lineWidth = 2; const x = R() * S, y = R() * S; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 10 + R() * 20, y + (R() - 0.5) * 30); g.stroke(); }
    grain(g, S, S, 26, R);
    TEX.cloth = mkTex(c);
  }
  // Blood decals.
  TEX.blood = [];
  for (let v = 0; v < 3; v++) {
    const S = 256, c = cnv(S, S), g = c.getContext('2d');
    const cx = S / 2, cy = S / 2;
    const col = (a) => `rgba(${70 + R() * 30},${4 + R() * 6},${4 + R() * 4},${a})`;
    for (let i = 0; i < 16; i++) { const a = R() * TAU, d = R() * 40, r = 14 + R() * 36; g.fillStyle = col(0.82); g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, TAU); g.fill(); }
    for (let i = 0; i < 40; i++) { const a = R() * TAU, d = 50 + R() * 70, r = 1 + R() * 6; g.fillStyle = col(0.85); g.beginPath(); g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, TAU); g.fill(); }
    for (let i = 0; i < 6; i++) { const a = R() * TAU; g.strokeStyle = col(0.8); g.lineWidth = 3 + R() * 5; g.lineCap = 'round'; g.beginPath(); g.moveTo(cx + Math.cos(a) * 40, cy + Math.sin(a) * 40); g.lineTo(cx + Math.cos(a) * (80 + R() * 40), cy + Math.sin(a) * (80 + R() * 40)); g.stroke(); }
    const id = g.getImageData(0, 0, S, S), d = id.data;
    for (let i = 0; i < d.length; i += 4) { if (d[i + 3] > 0) { const n = (R() - 0.5) * 30; d[i] = clamp(d[i] + n, 0, 255); } }
    g.putImageData(id, 0, 0);
    TEX.blood.push(mkTex(c, true, false));
  }
  // Bullet hole.
  {
    const S = 64, c = cnv(S, S), g = c.getContext('2d');
    blotch(g, 32, 32, 30, 'rgba(30,26,20,A)', 0.55);
    g.fillStyle = 'rgba(8,7,6,0.95)'; g.beginPath(); g.arc(32, 32, 6, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(15,12,10,0.7)'; for (let i = 0; i < 7; i++) { const a = R() * TAU; g.lineWidth = 1; g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * (10 + R() * 14), 32 + Math.sin(a) * (10 + R() * 14)); g.stroke(); }
    TEX.hole = mkTex(c, true, false);
  }
  // Soft round particle and muzzle flash star.
  {
    const c = cnv(64, 64), g = c.getContext('2d');
    blotch(g, 32, 32, 31, 'rgba(255,255,255,A)', 1);
    TEX.soft = mkTex(c, false, false);
    const f = cnv(128, 128), fg = f.getContext('2d');
    fg.translate(64, 64);
    for (let i = 0; i < 7; i++) {
      fg.rotate(TAU / 7 + R() * 0.3);
      const gr = fg.createLinearGradient(0, 0, 60, 0); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
      fg.fillStyle = gr; fg.beginPath(); fg.moveTo(0, -5); fg.lineTo(56 + R() * 6, 0); fg.lineTo(0, 5); fg.fill();
    }
    fg.setTransform(1, 0, 0, 1, 0, 0);
    blotch(fg, 64, 64, 34, 'rgba(255,230,170,A)', 1);
    TEX.flash = mkTex(f, true, false);
  }
}

// A stencilled floor sign, made per floor.
function floorSignTexture(n) {
  const c = cnv(512, 160), g = c.getContext('2d');
  g.fillStyle = '#1d1f1c'; g.fillRect(0, 0, 512, 160);
  g.strokeStyle = '#c9b23a'; g.lineWidth = 10; g.strokeRect(10, 10, 492, 140);
  g.fillStyle = '#d9c64a'; g.font = 'bold 92px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('FLOOR ' + String(n).padStart(2, '0'), 256, 84);
  const R = mulberry32(n * 31);
  grain(g, 512, 160, 30, R);
  blotches(g, 512, 160, R, 4, 'rgba(90,10,8,A)', 10, 30, 0.5, 0.8);
  return mkTex(c, true, false);
}
