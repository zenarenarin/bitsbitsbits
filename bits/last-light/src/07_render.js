// =====================================================================
// The renderer: a layered stage in Canvas2D.
//   sky and moon · far and middle skyline (parallax) · the Watcher's
//   shadow · ink façades · light (haze, then the paper engraving clipped
//   to every lamp's visibility polygon) · doorways · the playable
//   architecture · lit edges · the runner · wires · grain and vignette.
// =====================================================================
function createRenderer(canvas, level, world, optics, watcher, makeSurface) {
  const g = canvas.getContext('2d');
  // Offscreen caches are hidden SDK surfaces, pooled and reused.
  const free = [];
  const take = (w, h) => { const c = free.pop() || makeSurface(); c.width = w; c.height = h; return c; };
  const give = c => { if (c) { c.width = c.height = 1; free.push(c); } };
  const R = { cam: { x: level.start.x, yb: -0.6, s: 30, vx: 0 }, W: 1, H: 1, yBase: 1, q: 1, flash: 0, shake: 0, debug: false };
  const fac = new Map();
  const far = makeSkyline(11, -40, level.x1 * 0.3 + 60, 0.25), mid = makeSkyline(29, -30, level.x1 * 0.55 + 50, 0.55);
  const polys = new Map();
  let sky = null, vign = null;
  const scarf = [];

  R.layout = function (W, H, dpr, area, controlsH) {
    R.W = W; R.H = H; R.dpr = dpr; R.area = area;
    R.q = Math.min(dpr || 1, 1.5);
    const top = area.top + 44, bottom = H - area.bottom - controlsH;
    const s = Math.min(W / 13, (bottom - top) / 13.5);
    R.cam.s = clamp(s, 14, 64);
    R.yBase = bottom - 0.2 * R.cam.s;
    R.focusTop = top;
    R.viewM = (R.yBase - top) / R.cam.s;
    for (const v of fac.values()) { give(v.dark); give(v.lit); }
    fac.clear(); give(sky); sky = null; vign = null;
  };
  const X = wx => (wx - R.cam.x) * R.cam.s + R.W / 2;
  const Y = wy => R.yBase - (wy - R.cam.yb) * R.cam.s;
  R.X = X; R.Y = Y;
  R.toWorld = (sx, sy) => ({ x: (sx - R.W / 2) / R.cam.s + R.cam.x, y: (R.yBase - sy) / R.cam.s + R.cam.yb });

  R.follow = function (P, dt, snap) {
    const s = R.cam.s, halfW = R.W / 2 / s;
    const tx = clamp(P.x + P.face * 1.4 + P.vx * 0.22, level.x0 + halfW - 2, level.x1 - halfW + 1);
    // keep the runner in the lower-middle of the frame, never lose the street
    const ty = Math.max(-0.6, P.y + 1.2 - R.viewM * 0.58);
    if (snap) { R.cam.x = tx; R.cam.yb = ty; R.cam.vx = 0; return; }
    const k = 1 - Math.exp(-dt * 4.2);
    R.cam.x += (tx - R.cam.x) * k;
    const dy = ty - R.cam.yb;
    R.cam.yb += dy * (1 - Math.exp(-dt * (Math.abs(dy) > 2 ? 4 : 2.2)));
  };

  function facadeCanvas(f) {
    let c = fac.get(f);
    // the host may resize a surface; a cache that lost its pixels is redrawn
    if (c && c.dark.width === c.pw && c.lit.width === c.pw) return c;
    if (c) { give(c.dark); give(c.lit); fac.delete(f); }
    const s = R.cam.s * R.q, roof = facadeRoofH(f), w = f.x1 - f.x0, h = f.h + roof + 0.3;
    const mk = lit => {
      const cv = take(Math.ceil(w * s), Math.ceil(h * s));
      const cg = cv.getContext('2d');
      cg.translate(0, 0.3 * s);
      drawFacade(cg, f, s, lit);
      return cv;
    };
    // forget façades well off screen before making more
    const halfW = R.W / 2 / R.cam.s + 4;
    for (const [k, v] of fac) if (k.x1 < R.cam.x - halfW || k.x0 > R.cam.x + halfW) { give(v.dark); give(v.lit); fac.delete(k); }
    c = { dark: mk(false), lit: mk(true), roof, w, h };
    c.pw = c.dark.width;
    fac.set(f, c);
    return c;
  }
  function visibleFacades() {
    const halfW = R.W / 2 / R.cam.s + 1;
    return level.facades.filter(f => f.x1 > R.cam.x - halfW && f.x0 < R.cam.x + halfW);
  }
  function drawFacades(list, lit) {
    const s = R.cam.s;
    for (const f of list) {
      const c = facadeCanvas(f);
      g.drawImage(lit ? c.lit : c.dark, X(f.x0), Y(f.h + c.roof + 0.3), c.w * s, c.h * s);
    }
  }

  // -------------------------------------------------------------- sky
  function makeSky() {
    const W = R.W, H = R.H, c = take(Math.ceil(W * R.q), Math.ceil(H * R.q));
    const sg = c.getContext('2d'); sg.scale(R.q, R.q);
    const gr = sg.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, '#6c6963'); gr.addColorStop(0.55, '#8e8a82'); gr.addColorStop(1, '#a6a197');
    sg.fillStyle = gr; sg.fillRect(0, 0, W, H);
    // engraved sky: fine horizontal rules, denser toward the top
    sg.strokeStyle = 'rgba(30,28,25,0.22)'; sg.lineWidth = 0.7;
    for (let y = 0; y < H; y += 2.6 + y / H * 3.2) { sg.beginPath(); sg.moveTo(0, y); sg.lineTo(W, y + 0.6); sg.stroke(); }
    // clouds: wavy rules
    const r = rng(7);
    sg.strokeStyle = 'rgba(30,28,25,0.28)';
    for (let i = 0; i < 6; i++) {
      const cy = r.range(0.06, 0.4) * H, cx = r.range(0, W), cw = r.range(0.4, 0.9) * W;
      for (let k = 0; k < 9; k++) { sg.beginPath(); for (let x = -cw / 2; x < cw / 2; x += 6) { const yy = cy + k * 3 + Math.sin((x + k * 9) * 0.03) * 4 * (1 - Math.abs(x) / cw * 2); x === -cw / 2 ? sg.moveTo(cx + x, yy) : sg.lineTo(cx + x, yy); } sg.stroke(); }
    }
    // paper grain, baked in once
    const gc = take(128, 128); const gg = gc.getContext('2d'); const id = gg.createImageData(128, 128); const r2 = rng(5);
    for (let i = 0; i < id.data.length; i += 4) { const v = r2() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
    gg.putImageData(id, 0, 0);
    sg.globalAlpha = 0.07; sg.fillStyle = sg.createPattern(gc, 'repeat'); sg.fillRect(0, 0, W, H); sg.globalAlpha = 1;
    give(gc);
    c.pw = c.width;
    return c;
  }
  function drawMoon() {
    const r = Math.min(R.W, R.H) * 0.075, cx = R.W * 0.8 - R.cam.x * R.cam.s * 0.012, cy = R.focusTop + R.H * 0.2;
    g.fillStyle = '#c9c4b8'; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.fill();
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.clip();
    g.strokeStyle = 'rgba(40,38,34,0.35)'; g.lineWidth = 0.8;
    for (let y = -r; y < r; y += 3) { g.beginPath(); g.moveTo(cx - r + Math.max(0, y) * 0.4 + r * 0.55, cy + y); g.lineTo(cx + r, cy + y); g.stroke(); }
    g.restore();
  }

  // -------------------------------------------------------------- skyline
  function drawSkyline(list, par, scale, col, winCol, lift) {
    const s = R.cam.s * scale, base = Y(0) - lift * R.cam.s;
    g.fillStyle = col;
    const ox = R.W / 2 - R.cam.x * par * s / scale * scale;
    for (const b of list) {
      const x0 = ox + b.x * s, x1 = x0 + b.w * s;
      if (x1 < -40 || x0 > R.W + 40) continue;
      const h = b.h * s, ln = b.lean * h;
      g.beginPath();
      g.moveTo(x0, base + 10);
      if (b.kind === 'spire') { g.lineTo(x0 + ln * 0.6, base - h * 0.7); g.lineTo(x0 + b.w * s * 0.5 + ln, base - h * 1.15); g.lineTo(x1 + ln * 0.6, base - h * 0.7); }
      else if (b.kind === 'gable') { g.lineTo(x0 + ln * 0.8, base - h * 0.8); g.lineTo(x0 + b.w * s * 0.3 + ln, base - h); g.lineTo(x1 + ln * 0.8, base - h * 0.74); }
      else if (b.kind === 'tower') { g.lineTo(x0 + ln, base - h); g.lineTo(x0 + b.w * s * 0.2 + ln, base - h * 1.08); g.lineTo(x1 - b.w * s * 0.2 + ln, base - h * 1.08); g.lineTo(x1 + ln, base - h); }
      else if (b.kind === 'crane') { g.lineTo(x0 + ln, base - h * 0.6); g.lineTo(x0 + ln + b.w * s * 0.2, base - h * 0.6); g.lineTo(x0 + ln + b.w * s * 0.2, base - h * 1.1); g.lineTo(x1 + b.w * s * 0.8 + ln, base - h * 1.05); g.lineTo(x1 + b.w * s * 0.8 + ln, base - h * 1.0); g.lineTo(x1 + ln, base - h * 1.02); g.lineTo(x1 + ln * 0.5, base - h * 0.6); }
      else { g.lineTo(x0 + ln, base - h); g.lineTo(x1 + ln, base - h * 0.92); }
      g.lineTo(x1, base + 10);
      g.closePath(); g.fill();
      if (winCol) {
        for (const w of b.win) if (w.on || R.hunt > 0.5 && w.k < R.hunt) {
          const wx = x0 + (b.w * w.x) * s + ln * (w.y), wy = base - h * w.y;
          g.fillStyle = w.on ? winCol : '#b9b4a8';
          g.fillRect(wx, wy, Math.max(1.5, 0.35 * s), Math.max(2, 0.55 * s));
        }
        g.fillStyle = col;
      }
    }
  }

  // The Watcher's shadow: a tall hat and a long coat drifting across the far
  // houses toward where it last saw you. Never more than a shape.
  function drawWatcherShade(t) {
    const k = R.shade;
    if (k < 0.02) return;
    const s = R.cam.s * 0.55, base = Y(0) - 3 * R.cam.s;
    const cx = R.W / 2 + (R.shadeX - R.cam.x * 0.3) * s;
    const h = 30 * s;
    g.save();
    g.globalAlpha = k * 0.55;
    g.fillStyle = '#2c2a26';
    g.beginPath();
    const sway = Math.sin(t * 0.7) * 0.4 * s;
    g.moveTo(cx - 4.5 * s, base + 10);
    g.lineTo(cx - 2.2 * s + sway, base - h * 0.62);
    g.lineTo(cx - 1.6 * s + sway, base - h * 0.8);
    g.lineTo(cx - 1.0 * s + sway, base - h * 0.84);
    g.lineTo(cx - 1.1 * s + sway, base - h * 0.88);
    g.lineTo(cx - 2.6 * s + sway, base - h * 0.885);
    g.lineTo(cx - 2.4 * s + sway, base - h * 0.9);
    g.lineTo(cx - 1.0 * s + sway, base - h * 0.905);
    g.lineTo(cx - 0.9 * s + sway, base - h * 1.0);
    g.lineTo(cx + 1.3 * s + sway, base - h * 1.0);
    g.lineTo(cx + 1.4 * s + sway, base - h * 0.905);
    g.lineTo(cx + 2.8 * s + sway, base - h * 0.9);
    g.lineTo(cx + 2.9 * s + sway, base - h * 0.885);
    g.lineTo(cx + 1.4 * s + sway, base - h * 0.88);
    g.lineTo(cx + 1.3 * s + sway, base - h * 0.84);
    g.lineTo(cx + 2.4 * s + sway, base - h * 0.8);
    g.lineTo(cx + 3.6 * s + sway, base - h * 0.6);
    g.lineTo(cx + 5.5 * s, base + 10);
    g.closePath(); g.fill();
    g.restore();
  }

  // -------------------------------------------------------------- light
  function lampVisible(l) {
    const halfW = R.W / 2 / R.cam.s + 2;
    return l.on && l.x + l.range > R.cam.x - halfW && l.x - l.range < R.cam.x + halfW;
  }
  function beamPath(list) {
    g.beginPath();
    for (const p of list) { g.moveTo(X(p[0]), Y(p[1])); for (let i = 2; i < p.length; i += 2) g.lineTo(X(p[i]), Y(p[i + 1])); g.closePath(); }
  }

  // -------------------------------------------------------------- geometry
  function railing(p) {
    const s = R.cam.s;
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.06 * s);
    const top = p.y + 0.95;
    g.beginPath(); g.moveTo(X(p.x0 + 0.05), Y(top)); g.lineTo(X(p.x1 - 0.05), Y(top)); g.stroke();
    g.lineWidth = Math.max(0.8, 0.035 * s);
    g.beginPath();
    for (let x = p.x0 + 0.1; x < p.x1 - 0.05; x += 0.16) { g.moveTo(X(x), Y(p.y)); g.lineTo(X(x), Y(top)); }
    g.stroke();
    // a scroll every bay
    g.beginPath();
    for (let x = p.x0 + 0.5; x < p.x1 - 0.4; x += 1.1) { g.moveTo(X(x + 0.18), Y(p.y + 0.5)); g.arc(X(x), Y(p.y + 0.5), 0.18 * s, 0, TAU); }
    g.stroke();
  }
  function drawPlat(p) {
    const s = R.cam.s;
    g.fillStyle = INK;
    g.fillRect(X(p.x0), Y(p.y), (p.x1 - p.x0) * s, p.th * s);
    if (p.kind === 'balcony') {
      // corbels beneath
      for (let x = p.x0 + 0.3; x < p.x1 - 0.1; x += 1.4) {
        g.beginPath(); g.moveTo(X(x - 0.12), Y(p.y - p.th)); g.lineTo(X(x + 0.12), Y(p.y - p.th)); g.lineTo(X(x + 0.04), Y(p.y - p.th - 0.55)); g.lineTo(X(x - 0.04), Y(p.y - p.th - 0.55)); g.fill();
      }
      if (p.rail) railing(p);
    } else if (p.kind === 'roof') {
      // coping stones
      g.fillStyle = '#191817';
      for (let x = p.x0; x < p.x1; x += 0.9) g.fillRect(X(x) + 1, Y(p.y) + 2, 0.86 * s - 2, Math.max(1, p.th * s * 0.35));
    }
    // the walkable edge: a paper hairline
    g.fillStyle = 'rgba(236,231,220,0.75)';
    g.fillRect(X(p.x0), Y(p.y) - 0.5, (p.x1 - p.x0) * s, Math.max(1, 0.03 * s));
  }
  function drawSolid(b) {
    const s = R.cam.s;
    if (b.kind === 'edge' || b.kind === 'shutter') return;
    if (b.kind === 'street' || b.kind === 'cellar') {
      g.fillStyle = INK;
      g.fillRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s + (b.kind === 'street' ? R.H : 0));
      // cobbles: rows of small arcs
      g.strokeStyle = '#2b2a27'; g.lineWidth = Math.max(0.8, 0.03 * s);
      const xa = Math.max(b.x0, R.cam.x - R.W / 2 / s - 1), xb = Math.min(b.x1, R.cam.x + R.W / 2 / s + 1);
      for (let row = 0; row < 3; row++) {
        g.beginPath();
        const yy = b.y1 - 0.12 - row * 0.22, off = (row % 2) * 0.17;
        for (let x = Math.floor(xa / 0.34) * 0.34 + off; x < xb; x += 0.34) { g.moveTo(X(x), Y(yy)); g.quadraticCurveTo(X(x + 0.17), Y(yy + 0.16), X(x + 0.32), Y(yy)); }
        g.stroke();
      }
      g.fillStyle = 'rgba(236,231,220,0.7)';
      g.fillRect(X(b.x0), Y(b.y1) - 0.5, (b.x1 - b.x0) * s, Math.max(1, 0.03 * s));
      return;
    }
    g.fillStyle = INK;
    g.fillRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
    if (b.kind === 'chimney') {
      // brick courses and a pot
      g.strokeStyle = '#262522'; g.lineWidth = Math.max(0.7, 0.025 * s);
      g.beginPath(); for (let y = b.y0 + 0.25; y < b.y1; y += 0.25) { g.moveTo(X(b.x0), Y(y)); g.lineTo(X(b.x1), Y(y)); } g.stroke();
      g.fillStyle = INK;
      if (!b.stub) { const cx = (b.x0 + b.x1) / 2; g.fillRect(X(cx - 0.18), Y(b.y1 + 0.5), 0.36 * s, 0.5 * s); g.fillRect(X(b.x0 - 0.08), Y(b.y1), (b.x1 - b.x0 + 0.16) * s, 0.14 * s); }
    } else if (b.kind === 'gate') {
      g.strokeStyle = '#25241f'; g.lineWidth = Math.max(0.7, 0.025 * s);
      g.beginPath();
      for (let y = b.y0 + 0.5; y < b.y1; y += 0.5) { g.moveTo(X(b.x0), Y(y)); g.lineTo(X(b.x1), Y(y)); }
      g.stroke();
      // the passage's mouth: voussoirs over the shutter
      g.fillStyle = '#1b1a18';
      for (let i = 0; i < 7; i++) g.fillRect(X(b.x0 + 0.1 + i * 0.32), Y(b.y0 + 0.9 - Math.sin(i / 6 * Math.PI) * 0.4), 0.26 * s, 0.6 * s);
      // a carved eye over the gate: the city watches
      const ex = (b.x0 + b.x1) / 2, ey = b.y0 + 5.2;
      g.strokeStyle = '#3c3a35'; g.lineWidth = Math.max(1, 0.06 * s);
      g.beginPath(); g.moveTo(X(ex - 1.2), Y(ey)); g.quadraticCurveTo(X(ex), Y(ey + 0.9), X(ex + 1.2), Y(ey)); g.quadraticCurveTo(X(ex), Y(ey - 0.9), X(ex - 1.2), Y(ey)); g.stroke();
      g.beginPath(); g.arc(X(ex), Y(ey), 0.3 * s, 0, TAU); g.stroke();
    } else if (b.kind === 'pillar') {
      g.fillStyle = '#1e1d1b'; g.fillRect(X(b.x0 + 0.08), Y(b.y1 - 0.2), (b.x1 - b.x0 - 0.16) * s, (b.y1 - b.y0 - 0.4) * s);
    }
    if (b.kind !== 'pillar') { g.fillStyle = 'rgba(236,231,220,0.7)'; g.fillRect(X(b.x0), Y(b.y1) - 0.5, (b.x1 - b.x0) * s, Math.max(1, 0.03 * s)); }
  }
  function drawPipe(p) {
    const s = R.cam.s;
    g.strokeStyle = INK; g.lineWidth = Math.max(2, 0.13 * s); g.lineCap = 'butt';
    g.beginPath(); g.moveTo(X(p.x), Y(p.y0)); g.lineTo(X(p.x), Y(p.y1 + 0.2)); g.stroke();
    // hopper at the top, collars on the way down: small paper ticks say "climbable"
    g.fillStyle = INK; g.fillRect(X(p.x - 0.16), Y(p.y1 + 0.35), 0.32 * s, 0.3 * s);
    g.fillStyle = 'rgba(236,231,220,0.8)';
    for (let y = p.y0 + 0.6; y < p.y1; y += 1.2) g.fillRect(X(p.x - 0.11), Y(y), 0.22 * s, Math.max(1, 0.04 * s));
  }
  function drawAwning(a) {
    const s = R.cam.s, tip = world.awningTip(a), ang = world.awningAngle(a);
    const shake = a.shake ? Math.sin(R.t * 38) * 0.035 : 0;
    const ext = Math.hypot(tip.x - a.ax, tip.y - a.ay);
    // bracket arms from the wall
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.05 * s);
    g.beginPath(); g.moveTo(X(a.ax), Y(a.ay - 1.0)); g.lineTo(X(lerp(a.ax, tip.x, 0.55)), Y(lerp(a.ay, tip.y, 0.55))); g.stroke();
    // striped canvas, one stripe every 0.5 m of what has unrolled
    if (ext > 0.3) {
      const n = Math.max(1, Math.round(ext / 0.5));
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const ax = lerp(a.ax, tip.x, t0), ay = lerp(a.ay, tip.y, t0) + shake * t0, bx = lerp(a.ax, tip.x, t1), by = lerp(a.ay, tip.y, t1) + shake * t1;
        g.fillStyle = i % 2 ? '#45423d' : INK;
        g.beginPath(); g.moveTo(X(ax), Y(ay)); g.lineTo(X(bx), Y(by)); g.lineTo(X(bx), Y(by - 0.13)); g.lineTo(X(ax), Y(ay - 0.13)); g.fill();
      }
      // scalloped valance
      g.fillStyle = INK;
      const vx = tip.x, vy = tip.y + shake;
      g.beginPath(); g.moveTo(X(vx), Y(vy)); g.lineTo(X(vx), Y(vy - 0.42));
      for (let i = 1; i <= 4; i++) g.quadraticCurveTo(X(vx - a.dir * (i - 0.5) * 0.2), Y(vy - 0.56), X(vx - a.dir * i * 0.2), Y(vy - 0.42));
      g.lineTo(X(vx - a.dir * 0.8), Y(vy)); g.fill();
      g.fillStyle = 'rgba(236,231,220,0.75)'; g.fillRect(Math.min(X(a.ax), X(tip.x)), Y(Math.max(a.ay, tip.y)) - 0.5, Math.abs(X(tip.x) - X(a.ax)), Math.max(1, 0.03 * s));
    }
    // the roller
    g.fillStyle = INK; g.beginPath(); g.arc(X(a.ax + a.dir * 0.1), Y(a.ay - 0.05), (0.2 + 0.12 * (1 - a.t)) * s, 0, TAU); g.fill();
    g.strokeStyle = '#45423d'; g.lineWidth = Math.max(1, 0.04 * s); g.beginPath(); g.arc(X(a.ax + a.dir * 0.1), Y(a.ay - 0.05), (0.1 + 0.08 * (1 - a.t)) * s, 0, TAU); g.stroke();
    // the cord, with a paper toggle so it reads as something to pull
    const cy = a.cord.y + 1.15;
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.03 * s);
    g.beginPath(); g.moveTo(X(a.ax + a.dir * 0.1), Y(a.ay - 0.2)); g.lineTo(X(a.cord.x), Y(cy + 0.25)); g.stroke();
    g.fillStyle = a.cool > 0 || a.target ? '#7d786e' : PAPER;
    g.fillRect(X(a.cord.x - 0.07), Y(cy + 0.25), 0.14 * s, 0.28 * s);
  }
  function drawShutter(sh) {
    const s = R.cam.s;
    if (sh.top - sh.y < 0.01) return;
    g.fillStyle = '#24231f';
    g.fillRect(X(sh.x0 - 0.05), Y(sh.top), (sh.x1 - sh.x0 + 0.1) * s, (sh.top - sh.y) * s);
    g.strokeStyle = INK; g.lineWidth = Math.max(0.7, 0.03 * s);
    g.beginPath(); for (let y = sh.y + 0.12; y < sh.top; y += 0.12) { g.moveTo(X(sh.x0 - 0.05), Y(y)); g.lineTo(X(sh.x1 + 0.05), Y(y)); } g.stroke();
    // a hard paper edge on the descending bar: watch it
    g.fillStyle = PAPER; g.fillRect(X(sh.x0 - 0.06), Y(sh.y + 0.06), (sh.x1 - sh.x0 + 0.12) * s, Math.max(1.5, 0.06 * s));
  }
  function drawSheet(sh, lit) {
    const s = R.cam.s, sw = world.sheetSway(sh, R.t);
    g.fillStyle = lit ? PAPER2 : '#5c5850';
    g.beginPath();
    g.moveTo(X(sh.x - sh.w / 2), Y(sh.y));
    g.lineTo(X(sh.x + sh.w / 2), Y(sh.y));
    g.quadraticCurveTo(X(sh.x + sh.w / 2 + sw * 0.6), Y(sh.y - sh.h * 0.5), X(sh.x + sh.w / 2 + sw), Y(sh.y - sh.h));
    for (let i = 4; i >= 0; i--) g.lineTo(X(sh.x - sh.w / 2 + sw + sh.w * i / 4), Y(sh.y - sh.h - (i % 2) * 0.06));
    g.quadraticCurveTo(X(sh.x - sh.w / 2 + sw * 0.6), Y(sh.y - sh.h * 0.5), X(sh.x - sh.w / 2), Y(sh.y));
    g.fill();
    g.strokeStyle = 'rgba(13,13,12,0.6)'; g.lineWidth = Math.max(0.6, 0.025 * s);
    g.beginPath(); for (let i = 1; i < 4; i++) { const fx = sh.x - sh.w / 2 + sh.w * i / 4; g.moveTo(X(fx), Y(sh.y)); g.quadraticCurveTo(X(fx + sw * 0.5), Y(sh.y - sh.h * 0.5), X(fx + sw), Y(sh.y - sh.h)); } g.stroke();
    // pegs
    g.fillStyle = INK; g.fillRect(X(sh.x - sh.w / 2 + 0.1), Y(sh.y + 0.08), 0.06 * s, 0.18 * s); g.fillRect(X(sh.x + sh.w / 2 - 0.16), Y(sh.y + 0.08), 0.06 * s, 0.18 * s);
  }
  function drawLines() {
    // the laundry line and the pulley rope's beam
    const s = R.cam.s;
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.03 * s);
    if (level.sheets.length) {
      const a = level.sheets[0], b = level.sheets[level.sheets.length - 1];
      g.beginPath(); g.moveTo(X(a.x - 2.2), Y(a.y + 0.6)); g.quadraticCurveTo(X((a.x + b.x) / 2), Y(a.y - 0.25), X(b.x + 2.2), Y(a.y + 0.6)); g.stroke();
    }
    for (const r of level.ropes) {
      g.lineWidth = Math.max(2, 0.12 * s);
      g.beginPath(); g.moveTo(X(r.ax - 3), Y(r.ay + 0.25)); g.lineTo(X(r.ax + 3), Y(r.ay + 0.25)); g.stroke();
      g.fillStyle = INK; g.beginPath(); g.arc(X(r.ax), Y(r.ay), 0.22 * s, 0, TAU); g.fill();
      g.fillStyle = PAPER; g.beginPath(); g.arc(X(r.ax), Y(r.ay), 0.07 * s, 0, TAU); g.fill();
      const held = R.P && R.P.rope === r;
      const ang = held ? R.P.rAng : (r.sway || 0), L = held ? R.P.rLen : r.len;
      const ex = r.ax + Math.sin(ang) * L, ey = r.ay - Math.cos(ang) * L;
      g.lineWidth = Math.max(1.2, 0.045 * s);
      g.beginPath(); g.moveTo(X(r.ax), Y(r.ay)); g.lineTo(X(ex), Y(ey));
      if (held && L < r.len - 0.1) { const rest = r.len - L; g.lineTo(X(ex - Math.sin(ang) * 0.2), Y(ey - rest)); }
      g.stroke();
      if (!held) { g.fillStyle = PAPER; g.fillRect(X(ex) - 2, Y(ey) - 2, 4, 6); }
    }
  }
  function drawRecess(r) {
    const s = R.cam.s, b = r.y0, h = r.y1 - b;
    g.fillStyle = '#050505';
    g.beginPath(); g.moveTo(X(r.x0), Y(b)); g.lineTo(X(r.x0), Y(r.y1 - 0.5)); g.quadraticCurveTo(X((r.x0 + r.x1) / 2), Y(r.y1 + 0.3), X(r.x1), Y(r.y1 - 0.5)); g.lineTo(X(r.x1), Y(b)); g.fill();
    if (r.open > 0.01) {
      // a door swings open and the room behind it is lit: the doorway is no longer a hiding place
      const w = (r.x1 - r.x0 - 0.3) * r.open;
      g.fillStyle = PAPER;
      g.fillRect(X(r.x0 + 0.15), Y(r.y1 - 0.6), w * s, (h - 0.6) * s);
      g.globalAlpha = 0.18 * r.open; g.beginPath(); g.moveTo(X(r.x0 + 0.15), Y(b)); g.lineTo(X(r.x0 + 0.15 + w), Y(b)); g.lineTo(X(r.x0 + 0.15 + w * 2.4), Y(b - 0.1)); g.lineTo(X(r.x0 - 0.6), Y(b - 0.1)); g.fill(); g.globalAlpha = 1;
    }
    g.strokeStyle = INK; g.lineWidth = Math.max(1.5, 0.08 * s);
    g.beginPath(); g.moveTo(X(r.x0 - 0.05), Y(b)); g.lineTo(X(r.x0 - 0.05), Y(r.y1 - 0.5)); g.quadraticCurveTo(X((r.x0 + r.x1) / 2), Y(r.y1 + 0.35), X(r.x1 + 0.05), Y(r.y1 - 0.5)); g.lineTo(X(r.x1 + 0.05), Y(b)); g.stroke();
    g.fillStyle = 'rgba(236,231,220,0.5)'; g.fillRect(X(r.x0 - 0.2), Y(b + 0.04), (r.x1 - r.x0 + 0.4) * s, Math.max(1, 0.03 * s));
  }

  // The Watcher's attention, drawn where it matters. Around the runner an
  // aperture closes while any lamp has them: dashed while exposed, solid
  // with lock-on marks once detected. Where it searches after losing them,
  // a faint dashed ring marks its last known position.
  function drawAttention(P) {
    const s = R.cam.s, m = watcher.mode, st = watcher.exposureState();
    const cx = X(P.x), cy = Y(P.y + P.h * 0.55);
    const tracked = m === 'track' || m === 'hunt';
    const k = tracked ? 0.45 + 0.55 * watcher.L : m === 'notice' ? watcher.S * 0.45 : 0;
    R.ap = approach(R.ap || 0, k, 0.06);
    const lit = watcher.seenFrac > 0, lostYou = tracked && watcher.lost > 0.6;
    R.apA = approach(R.apA || 0, lit ? 0.9 : lostYou ? 0.12 : 0.45, 0.05);
    if (R.ap > 0.02 && (lit || tracked || m === 'notice')) {
      const r = lerp(2.6, 0.75, R.ap) * s;
      g.save();
      g.strokeStyle = PAPER; g.globalAlpha = R.apA; g.lineWidth = tracked ? 2 : 1.3;
      if (!tracked) g.setLineDash([4, 5]);
      g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
      g.setLineDash([]);
      if (tracked) {
        const n = m === 'hunt' ? 6 : 4, tick = (m === 'hunt' ? 0.5 : 0.35) * s, rot = m === 'hunt' ? R.t * 1.4 : 0;
        g.beginPath();
        for (let i = 0; i < n; i++) { const a = rot + i * TAU / n; g.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.lineTo(cx + Math.cos(a) * (r - tick), cy + Math.sin(a) * (r - tick)); }
        g.stroke();
      }
      g.restore();
    }
    // it is searching somewhere else
    if (tracked && watcher.lost > 0.6) {
      const lx = X(watcher.last.x), ly = Y(watcher.last.y + 0.8), r = (1.5 + 0.15 * Math.sin(R.t * 3)) * s;
      g.save(); g.strokeStyle = PAPER; g.globalAlpha = 0.55 + 0.2 * Math.sin(R.t * 5); g.lineWidth = 1.6; g.setLineDash([3, 6]);
      g.beginPath(); g.arc(lx, ly, r, 0, TAU); g.stroke();
      g.setLineDash([]); g.beginPath(); g.moveTo(lx - 0.2 * s, ly); g.lineTo(lx + 0.2 * s, ly); g.moveTo(lx, ly - 0.2 * s); g.lineTo(lx, ly + 0.2 * s); g.stroke();
      g.restore();
    }
    // being lit: the edges of the page whiten a little
    R.litGlow = approach(R.litGlow || 0, lit ? watcher.seenFrac : 0, 0.08);
    if (R.litGlow > 0.01) {
      const W = R.W, H = R.H;
      const gr = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.42, W / 2, H / 2, Math.max(W, H) * 0.72);
      gr.addColorStop(0, 'rgba(236,231,220,0)'); gr.addColorStop(1, 'rgba(236,231,220,' + (0.22 * R.litGlow).toFixed(3) + ')');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
  }
  // Capture: the light closes on the runner like an iris.
  function drawCaptureIris() {
    const c = R.capture; if (!c) return;
    const k = clamp(c.t / 0.75, 0, 1), W = R.W, H = R.H;
    const cx = X(c.x), cy = Y(c.y + 0.9);
    const rMax = Math.hypot(W, H);
    const r = lerp(rMax, 0.9 * R.cam.s, smooth(Math.min(1, k * 1.15)));
    g.save();
    g.fillStyle = 'rgba(236,231,220,' + (0.55 + 0.4 * k).toFixed(3) + ')';
    g.beginPath(); g.rect(0, 0, W, H); g.arc(cx, cy, r, 0, TAU, true); g.fill('evenodd');
    g.strokeStyle = INK; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
    g.restore();
  }

  function drawLamp(l) {
    const s = R.cam.s;
    g.strokeStyle = INK; g.fillStyle = INK; g.lineWidth = Math.max(1.5, 0.08 * s);
    if (l.kind === 'tower') {
      const f = level.facades.find(f => l.x >= f.x0 && l.x <= f.x1);
      const base = f ? f.h : 0;
      g.lineWidth = Math.max(1, 0.05 * s);
      g.beginPath(); g.moveTo(X(l.x - 0.7), Y(base)); g.lineTo(X(l.x - 0.12), Y(l.y - 0.3)); g.moveTo(X(l.x + 0.7), Y(base)); g.lineTo(X(l.x + 0.12), Y(l.y - 0.3));
      for (let y = base + 0.8; y < l.y - 0.4; y += 1.1) { const k = (y - base) / (l.y - base); const w = lerp(0.7, 0.12, k); g.moveTo(X(l.x - w), Y(y)); g.lineTo(X(l.x + lerp(0.7, 0.12, k + 1.1 / (l.y - base))), Y(y + 1.1)); }
      g.stroke();
    } else if (l.kind === 'bracket') {
      const d = -sign(Math.cos(l.base));
      g.beginPath(); g.moveTo(X(l.x + d * 1.0), Y(l.y + 0.5)); g.quadraticCurveTo(X(l.x + d * 0.3), Y(l.y + 0.6), X(l.x), Y(l.y + 0.15)); g.stroke();
      g.beginPath(); g.moveTo(X(l.x + d * 1.0), Y(l.y - 0.4)); g.lineTo(X(l.x + d * 1.0), Y(l.y + 0.7)); g.stroke();
    } else if (l.kind === 'lantern') {
      g.lineWidth = Math.max(1, 0.04 * s);
      g.beginPath(); g.moveTo(X(l.x), Y(l.y + 0.2)); g.lineTo(X(l.x), Y(l.y + 1.0)); g.stroke();
    }
    // the lamp head points where it looks
    const ang = l.ang, c = Math.cos(ang), sn = Math.sin(ang);
    const bx = l.x - c * 0.35, by = l.y - sn * 0.35;
    g.save(); g.translate(X(bx), Y(by)); g.rotate(-ang);
    g.fillStyle = INK;
    g.beginPath(); g.moveTo(-0.35 * s, -0.18 * s); g.lineTo(0.3 * s, -0.27 * s); g.lineTo(0.3 * s, 0.27 * s); g.lineTo(-0.35 * s, 0.18 * s); g.fill();
    g.fillRect(-0.5 * s, -0.08 * s, 0.2 * s, 0.16 * s);
    // the lens: paper, with an iris that tightens when it sees you
    g.fillStyle = PAPER; g.beginPath(); g.ellipse(0.33 * s, 0, 0.07 * s, 0.24 * s, 0, 0, TAU); g.fill();
    if (l.focus > 0.05) { g.fillStyle = INK; g.beginPath(); g.ellipse(0.34 * s, 0, 0.05 * s, 0.24 * s * (1 - 0.65 * l.focus) * 0.5 + 0.04 * s, 0, 0, TAU); g.fill(); }
    g.restore();
  }
  function drawProps() {
    const s = R.cam.s;
    for (const p of level.props) {
      if (p.kind === 'lamppost') {
        g.fillStyle = INK;
        g.fillRect(X(p.x - 0.09), Y(p.top - 0.3), 0.18 * s, (p.top - 0.3) * s);
        g.fillRect(X(p.x - 0.3), Y(0.6), 0.6 * s, 0.6 * s);
        g.fillRect(X(p.x - 0.5), Y(p.top + 0.2), 1.0 * s, 0.12 * s);
        g.beginPath(); g.moveTo(X(p.x - 0.4), Y(p.top + 0.3)); g.lineTo(X(p.x), Y(p.top + 0.9)); g.lineTo(X(p.x + 0.4), Y(p.top + 0.3)); g.fill();
      } else if (p.kind === 'pilaster') {
        // the awning's post, set into the façade behind the street
        g.fillStyle = '#121211'; g.fillRect(X(p.x - 0.22), Y(p.top), 0.44 * s, p.top * s);
        g.fillStyle = '#262522'; g.fillRect(X(p.x - 0.14), Y(p.top - 0.3), 0.28 * s, (p.top - 0.6) * s);
      } else if (p.kind === 'arch') {
        // the city gate at the end of the street: through it is the dark
        const x0 = p.x, x1 = p.x + 6;
        g.fillStyle = '#030303';
        g.beginPath(); g.moveTo(X(x0 + 0.8), Y(0)); g.lineTo(X(x0 + 0.8), Y(3.6)); g.quadraticCurveTo(X(x0 + 3), Y(6.4), X(x1 - 0.8), Y(3.6)); g.lineTo(X(x1 - 0.8), Y(0)); g.fill();
      }
    }
  }

  // The near side of the street, under the controls: cobbles running toward
  // us and an iron railing in front. Passive scenery only.
  function drawForeground() {
    const s = R.cam.s, y0 = Y(0), W = R.W;
    if (y0 > R.H) return;
    const xa = R.cam.x - W / 2 / s - 1, xb = R.cam.x + W / 2 / s + 1;
    for (let row = 1; row < 6; row++) {
      const yy = -0.25 - row * 0.32, k = 1 - row / 6;
      g.strokeStyle = 'rgba(60,58,53,' + (0.55 * k).toFixed(3) + ')'; g.lineWidth = Math.max(0.8, 0.03 * s);
      const w = 0.34 * (1 + row * 0.12), off = (row % 2) * w / 2;
      g.beginPath();
      for (let x = Math.floor(xa / w) * w + off; x < xb; x += w) { g.moveTo(X(x), Y(yy)); g.quadraticCurveTo(X(x + w / 2), Y(yy + 0.15), X(x + w - 0.03), Y(yy)); }
      g.stroke();
    }
    // a gutter and the kerb of the near pavement
    g.fillStyle = '#080808'; g.fillRect(0, Y(-2.1), W, Math.max(2, 0.12 * s));
    g.fillStyle = '#141312'; g.fillRect(0, Y(-2.22), W, R.H);
    g.fillStyle = 'rgba(236,231,220,0.12)'; g.fillRect(0, Y(-2.22), W, 1);
    // railing, nearer than the street, so it slides by faster
    const par = 1.3, sp = s * par, top = Y(-2.5), base = Y(-2.5) + 1.6 * sp;
    const ox = W / 2 - R.cam.x * sp;
    g.fillStyle = INK; g.strokeStyle = INK;
    g.fillRect(0, top + 0.18 * sp, W, Math.max(2, 0.07 * sp));
    g.fillRect(0, base - 0.25 * sp, W, Math.max(2, 0.07 * sp));
    const step = 0.24 * sp, start = ((ox % step) + step) % step;
    g.lineWidth = Math.max(1, 0.04 * sp);
    g.beginPath();
    for (let x = start - step; x < W + step; x += step) { g.moveTo(x, top + 0.1 * sp); g.lineTo(x, base); }
    g.stroke();
    for (let x = start - step; x < W + step; x += step) { g.beginPath(); g.moveTo(x - 0.05 * sp, top + 0.12 * sp); g.lineTo(x, top - 0.05 * sp); g.lineTo(x + 0.05 * sp, top + 0.12 * sp); g.fill(); }
    // posts and bollards every few metres
    const pstep = 4.8 * sp, pstart = (((ox + 1.1 * sp) % pstep) + pstep) % pstep;
    for (let x = pstart - pstep; x < W + pstep; x += pstep) {
      g.fillRect(x - 0.07 * sp, top - 0.25 * sp, 0.14 * sp, base - top + 0.25 * sp);
      g.beginPath(); g.arc(x, top - 0.28 * sp, 0.1 * sp, 0, TAU); g.fill();
    }
    g.fillStyle = '#0a0a09'; g.fillRect(0, base, W, R.H);
  }

  // -------------------------------------------------------------- the runner
  function pose(P, t) {
    const f = P.face, x = P.x, y = P.y;
    const J = {};
    let lean = 0, hipY = 0.86, neckH = 0.58;
    const sp = clamp(Math.abs(P.vx) / MOVE.run, 0, 1);
    const leg = (hip, a, b, L1, L2) => { const k = { x: hip.x + Math.sin(a) * f * L1, y: hip.y - Math.cos(a) * L1 }; return [k, { x: k.x + Math.sin(b) * f * L2, y: k.y - Math.cos(b) * L2 }]; };
    const arm = (sh, a, b) => { const e = { x: sh.x + Math.sin(a) * f * 0.29, y: sh.y - Math.cos(a) * 0.29 }; return [e, { x: e.x + Math.sin(b) * f * 0.27, y: e.y - Math.cos(b) * 0.27 }]; };
    let la = [0, 0], lb = [0, 0], aa = [0.1, -0.1], ab = [0.25, 0.1];
    const st = P.state;
    if (st === 'ground' || st === 'pull') {
      if (P.slideT > 0) { hipY = 0.34; lean = -0.55; la = [1.45, -0.2]; lb = [1.55, 1.6]; aa = [-0.6, 1.2]; ab = [-0.2, 1.9]; }
      else if (P.crouch) { hipY = 0.5; lean = 0.55; const ph = P.run * TAU / 1.0; la = [0.9 + Math.sin(ph) * 0.3 * sp, -0.5]; lb = [0.7 - Math.sin(ph) * 0.3 * sp, -0.6]; aa = [0.6, 0.5]; ab = [0.3, 1.0]; }
      else if (sp > 0.05) {
        const ph = P.run * TAU / 1.6;
        hipY = 0.84 + Math.abs(Math.sin(ph)) * 0.05 * sp;
        lean = 0.2 * sp;
        for (let i = 0; i < 2; i++) { const q = ph + i * Math.PI; la[i] = Math.sin(q) * 0.75 * sp; lb[i] = la[i] - (0.15 + Math.max(0, -Math.cos(q)) * 1.3) * sp; aa[i] = -Math.sin(q) * 0.85 * sp; ab[i] = aa[i] + 1.2 * sp + 0.2; }
      } else {
        const br = Math.sin(t * 2.1) * 0.012;
        hipY = 0.86 + br; la = [0.06, -0.08]; lb = [0.04, -0.06]; aa = [0.08, -0.12]; ab = [0.2, 0.0];
      }
      if (st === 'pull') { aa = [3.0, 0.4]; ab = [3.0, 0.5]; lean = -0.3; }
      hipY -= P.landK * 0.25;
    } else if (st === 'air') {
      if (P.vaultT > 0) { hipY = 0.75; lean = 0.4; la = [1.4, 1.2]; lb = [-1.0, 0.2]; aa = [0.9, 1.4]; ab = [1.1, 1.4]; }
      else if (P.vy > 1) { la = [1.0, -0.35]; lb = [-0.5, -0.3]; aa = [-0.6, 2.6]; ab = [0.2, 2.9]; lean = 0.15; }
      else { const k = clamp(-P.vy / 12, 0, 1); la = [0.5 - k * 0.3, -0.25]; lb = [-0.2 + k * 0.1, -0.4]; aa = [1.9 + k * 0.5, -1.5 - k * 0.6]; ab = [2.4, -1.0]; lean = 0.1; }
    } else if (st === 'hang' || st === 'climbup' || st === 'rope') {
      const sw = Math.sin(t * 3 + P.run * 3) * 0.12;
      la = [sw + 0.15, sw - 0.2]; lb = [-sw, -sw - 0.3]; aa = [Math.PI - 0.12, Math.PI - 0.05]; ab = [Math.PI + 0.1, Math.PI + 0.05];
      if (st === 'climbup' && P.climb) { const k = P.climb.t; hipY = 0.86 + 0.1 * k; la = [1.5 * Math.sin(k * Math.PI), 0]; lb = [-0.2, 0]; aa = [Math.PI * (1 - k * 0.8), 0.3]; ab = [Math.PI * (1 - k * 0.85), 0.2]; lean = 0.5 * Math.sin(k * Math.PI); }
      if (st === 'rope') { la = [0.35, -0.1]; lb = [0.1, -0.2]; }
    } else if (st === 'pipe') {
      const ph = (P.climbPhase || 0) * 3.2;
      la = [0.9 + Math.sin(ph) * 0.4, -0.6]; lb = [0.4 - Math.sin(ph) * 0.4, -0.8];
      aa = [2.6 + Math.sin(ph) * 0.3, 2.9]; ab = [2.2 - Math.sin(ph) * 0.3, 2.6]; lean = 0.15;
    } else if (st === 'caught' || st === 'gone') {
      hipY = 0.8; la = [0.2, -0.1]; lb = [-0.2, -0.3]; aa = [2.2, 3.4]; ab = [2.0, 3.3]; lean = -0.2;
    }
    const sc = P.crouch || P.slideT > 0 ? 1 : 1;
    const hip = { x, y: y + hipY * sc };
    const neck = { x: hip.x + Math.sin(lean) * f * neckH, y: hip.y + Math.cos(lean) * neckH };
    J.hip = hip; J.neck = neck;
    J.head = { x: neck.x + Math.sin(lean) * f * 0.2, y: neck.y + 0.19 };
    const sh = { x: neck.x - Math.sin(lean) * f * 0.06, y: neck.y - 0.05 };
    J.sh = sh;
    J.legs = [leg(hip, la[0], lb[0], 0.44, 0.44), leg(hip, la[1], lb[1], 0.44, 0.44)];
    J.arms = [arm(sh, aa[0], ab[0]), arm(sh, aa[1], ab[1])];
    // hands on what they hold
    if (st === 'hang' && P.ledge) { const lx = P.x, ly = P.ledge.y + 0.03; J.arms[0][1] = { x: lx - 0.13, y: ly }; J.arms[1][1] = { x: lx + 0.13, y: ly }; J.arms[0][0] = { x: lx - 0.16, y: (ly + sh.y) / 2 }; J.arms[1][0] = { x: lx + 0.16, y: (ly + sh.y) / 2 }; }
    if (st === 'rope') { const hy = P.y + P.h + 0.1; J.arms[0][1] = { x: P.x, y: hy }; J.arms[1][1] = { x: P.x, y: hy - 0.15 }; J.arms[0][0] = { x: P.x - 0.1 * f, y: (hy + sh.y) / 2 }; J.arms[1][0] = { x: P.x + 0.06 * f, y: (hy + sh.y) / 2 - 0.05 }; }
    if (st === 'pipe' && P.pipe) { const ph = (P.climbPhase || 0) * 3.2; J.arms[0][1] = { x: P.pipe.x, y: P.y + 1.55 + Math.sin(ph) * 0.15 }; J.arms[1][1] = { x: P.pipe.x, y: P.y + 1.2 - Math.sin(ph) * 0.15 }; }
    J.lean = lean; J.f = f;
    return J;
  }
  function figure(P, t, rim) {
    const s = R.cam.s, J = pose(P, t), f = J.f;
    const extra = rim ? 0.075 : 0;
    g.strokeStyle = rim ? PAPER : INK; g.fillStyle = rim ? PAPER : INK;
    g.lineCap = 'round'; g.lineJoin = 'round';
    const seg = (a, b, w) => { g.lineWidth = (w + extra) * s; g.beginPath(); g.moveTo(X(a.x), Y(a.y)); g.lineTo(X(b.x), Y(b.y)); g.stroke(); };
    const limb = (root, l, w) => { g.lineWidth = (w + extra) * s; g.beginPath(); g.moveTo(X(root.x), Y(root.y)); g.lineTo(X(l[0].x), Y(l[0].y)); g.lineTo(X(l[1].x), Y(l[1].y)); g.stroke(); };
    // far arm and leg first
    limb(J.sh, J.arms[1], 0.1); limb(J.hip, J.legs[1], 0.15);
    // coat: shoulders to a hem that swings behind with speed
    const sp = clamp(P.vx * f / MOVE.run, -1, 1);
    const hemBack = 0.1 + Math.max(0, sp) * 0.22 + (P.state === 'air' ? clamp(-P.vy / 30, -0.1, 0.25) : 0);
    const hx = J.hip.x, hy = J.hip.y;
    g.lineWidth = extra * s;
    g.beginPath();
    g.moveTo(X(J.sh.x - f * 0.13), Y(J.sh.y + 0.04));
    g.lineTo(X(J.sh.x + f * 0.12), Y(J.sh.y + 0.02));
    g.lineTo(X(hx + f * 0.16), Y(hy - 0.05));
    g.lineTo(X(hx + f * 0.06), Y(hy - 0.34));
    g.lineTo(X(hx - f * (0.2 + hemBack)), Y(hy - 0.3 + hemBack * 0.3));
    g.lineTo(X(hx - f * 0.15), Y(hy + 0.02));
    g.closePath();
    g.fill(); if (rim) g.stroke();
    limb(J.hip, J.legs[0], 0.16);
    limb(J.sh, J.arms[0], 0.11);
    // head and a flat cap
    g.beginPath(); g.arc(X(J.head.x), Y(J.head.y), (0.15 + extra * 0.5) * s, 0, TAU); g.fill();
    g.beginPath();
    g.moveTo(X(J.head.x - f * 0.17), Y(J.head.y + 0.06)); g.lineTo(X(J.head.x + f * 0.27), Y(J.head.y + 0.04));
    g.lineTo(X(J.head.x + f * 0.13), Y(J.head.y + 0.16)); g.lineTo(X(J.head.x - f * 0.12), Y(J.head.y + 0.19)); g.closePath();
    g.fill(); if (rim) { g.lineWidth = extra * s; g.stroke(); }
    // scarf
    if (scarf.length) {
      g.lineWidth = (0.07 + extra) * s;
      g.beginPath(); g.moveTo(X(J.neck.x), Y(J.neck.y)); for (const q of scarf) g.lineTo(X(q.x), Y(q.y)); g.stroke();
    }
    return J;
  }
  function updateScarf(P, dt) {
    const J = pose(P, R.t);
    if (!scarf.length) for (let i = 0; i < 4; i++) scarf.push({ x: J.neck.x, y: J.neck.y });
    let px = J.neck.x, py = J.neck.y;
    for (let i = 0; i < scarf.length; i++) {
      const q = scarf[i];
      const tx = px - P.face * 0.14 - P.vx * 0.012, ty = py - 0.06 + Math.sin(R.t * 6 + i) * 0.02 + clamp(P.vy * 0.004, -0.05, 0.05) - (Math.abs(P.vx) < 1 ? 0.07 : 0);
      const k = 1 - Math.exp(-dt * (24 - i * 4));
      q.x += (tx - q.x) * k; q.y += (ty - q.y) * k;
      const dx = q.x - px, dy = q.y - py, d = Math.hypot(dx, dy) || 1;
      if (d > 0.17) { q.x = px + dx / d * 0.17; q.y = py + dy / d * 0.17; }
      px = q.x; py = q.y;
    }
  }

  // -------------------------------------------------------------- frame
  R.draw = function (S, dt) {
    const P = S.player; R.P = P; R.t = S.time;
    const W = R.W, H = R.H, s = R.cam.s;
    R.hunt = approach(R.hunt || 0, watcher.mode === 'hunt' ? 1 : 0, dt * 0.6);
    R.shade = approach(R.shade || 0, watcher.mode === 'track' || watcher.mode === 'hunt' ? 1 : watcher.mode === 'investigate' ? 0.4 : 0, dt * 0.5);
    R.shadeX = lerp(R.shadeX === undefined ? watcher.last.x * 0.55 : R.shadeX, watcher.last.x * 0.55 + 10, 1 - Math.exp(-dt * 0.4));
    updateScarf(P, dt);
    g.setTransform(R.dpr, 0, 0, R.dpr, 0, 0);
    if (!sky || sky.width !== sky.pw) { give(sky); sky = makeSky(); }
    g.drawImage(sky, 0, 0, W, H);
    drawMoon();
    drawSkyline(far, 0.25, 0.42, '#6b6760', '#9b968b', -2.5);
    drawWatcherShade(S.time);
    drawSkyline(mid, 0.55, 0.62, '#45433e', '#77736a', -1.0);

    const facs = visibleFacades();
    drawFacades(facs, false);

    // the Watcher's light
    const list = [];
    for (const l of level.lights) {
      if (!lampVisible(l)) continue;
      let p = polys.get(l); if (!p) { p = []; polys.set(l, p); }
      optics.polygon(l, p);
      list.push(p);
      l.poly = p;
    }
    if (list.length) {
      // the engraving, where light falls
      g.save(); beamPath(list); g.clip();
      drawFacades(facs, true);
      g.fillStyle = 'rgba(236,231,220,0.16)'; g.fillRect(0, 0, W, H);
      g.restore();
      // haze in the air, stronger as a lamp focuses
      for (const l of level.lights) {
        if (!l.poly || !lampVisible(l)) continue;
        g.save(); beamPath([l.poly]);
        const gr = g.createRadialGradient(X(l.x), Y(l.y), 0, X(l.x), Y(l.y), l.range * s);
        const a0 = 0.34 + l.focus * 0.2;
        gr.addColorStop(0, 'rgba(236,231,220,' + a0.toFixed(3) + ')');
        gr.addColorStop(0.55, 'rgba(236,231,220,' + (a0 * 0.55).toFixed(3) + ')');
        gr.addColorStop(1, 'rgba(236,231,220,0.04)');
        g.fillStyle = gr; g.fill();
        g.strokeStyle = 'rgba(236,231,220,0.5)'; g.lineWidth = 1; g.stroke();
        g.restore();
      }
    }
    // doorways sit on top of the light: inside one, the light cannot reach you
    for (const r of level.recesses) if (r.x1 > R.cam.x - W / 2 / s - 1 && r.x0 < R.cam.x + W / 2 / s + 1) drawRecess(r);
    // the cellar's dark interior, under the court
    for (const b of level.solids) if (b.kind === 'cellar') { g.fillStyle = '#070707'; g.fillRect(X(b.x0), Y(0), (b.x1 - b.x0) * s, 3 * s); }
    drawLines();
    for (const sh of level.sheets) drawSheet(sh);
    for (const p of level.plats) if (p.x1 > R.cam.x - W / 2 / s - 2 && p.x0 < R.cam.x + W / 2 / s + 2) drawPlat(p);
    for (const b of level.solids) if (b.x1 > R.cam.x - W / 2 / s - 2 && b.x0 < R.cam.x + W / 2 / s + 2) drawSolid(b);
    for (const p of level.pipes) drawPipe(p);
    for (const a of level.awnings) drawAwning(a);
    for (const sh of level.shutters) drawShutter(sh);
    drawProps();
    // lit edges: where the light touches geometry it shows as paper
    if (list.length) {
      g.save(); beamPath(list); g.clip();
      g.fillStyle = PAPER;
      for (const p of level.plats) g.fillRect(X(p.x0), Y(p.y) - 1, (p.x1 - p.x0) * s, Math.max(2, 0.09 * s));
      for (const b of level.solids) if (b.kind !== 'edge') g.fillRect(X(b.x0), Y(b.y1) - 1, (b.x1 - b.x0) * s, Math.max(2, 0.09 * s));
      for (const sh of level.sheets) drawSheet(sh, true);
      g.restore();
    }
    for (const l of level.lights) if (l.on && l.x > R.cam.x - W / 2 / s - 3 && l.x < R.cam.x + W / 2 / s + 3) drawLamp(l);

    // the runner: paper rim, then ink
    if (P.state !== 'gone') {
      g.save();
      if (watcher.hidden) g.globalAlpha = 0.55;
      figure(P, S.time, true); figure(P, S.time, false);
      g.restore();
    }
    drawForeground();
    if (P.state !== 'gone' && !R.capture) drawAttention(P);
    drawCaptureIris();
    // wires in the foreground
    g.strokeStyle = INK; g.lineWidth = Math.max(1, 0.04 * s);
    for (let i = 0; i < 3; i++) {
      const par = 1.18, x0 = (i * 37 + 8), span = 26;
      const ox = R.W / 2 + (x0 - R.cam.x * par) * s;
      if (ox > W + 50 || ox + span * s < -50) continue;
      const y0 = R.focusTop - 30 + i * 8;
      g.beginPath(); g.moveTo(ox, y0); g.quadraticCurveTo(ox + span * s / 2, y0 + 2.5 * s, ox + span * s, y0 - 4); g.stroke();
    }
    // paper grain and vignette
    if (!vign) { vign = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.35, W / 2, H * 0.45, Math.max(W, H) * 0.75); vign.addColorStop(0, 'rgba(0,0,0,0)'); vign.addColorStop(1, 'rgba(0,0,0,0.55)'); }
    g.fillStyle = vign; g.fillRect(0, 0, W, H);
    if (R.flash > 0) { g.fillStyle = 'rgba(236,231,220,' + Math.min(1, R.flash).toFixed(3) + ')'; g.fillRect(0, 0, W, H); }
    if (R.debug) drawDebug(S);
  };

  function drawDebug(S) {
    const s = R.cam.s;
    g.strokeStyle = 'rgba(255,0,0,0.8)'; g.lineWidth = 1;
    for (const b of world.solids()) g.strokeRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
    g.strokeStyle = 'rgba(0,160,255,0.9)';
    for (const p of world.plats()) g.strokeRect(X(p.x0), Y(p.y), (p.x1 - p.x0) * s, p.th * s);
    const P = S.player, b = P.box();
    g.strokeStyle = 'lime'; g.strokeRect(X(b.x0), Y(b.y1), (b.x1 - b.x0) * s, (b.y1 - b.y0) * s);
  }
  return R;
}
