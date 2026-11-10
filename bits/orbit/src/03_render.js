// Board rendering (Canvas2D vector paths): GameBoard, OrbitRing, RingSegment,
// the ground, the hub and every material/lighting pass. Reads state, never writes it.

// Offscreen scratch surfaces (textures, layers, thumbnails). Plethora mounts
// visible canvases only through ctx.createCanvas2D, so these never touch the DOM.
function makeCanvas(w, h) {
  return new OffscreenCanvas(Math.max(1, Math.ceil(w)), Math.max(1, Math.ceil(h)));
}

// Show an offscreen surface in the DOM as an <img> (filled once encoded).
function surfaceToImage(surface, sizeCss) {
  const img = document.createElement('img');
  img.alt = '';
  img.width = img.height = sizeCss;
  img.style.width = img.style.height = sizeCss + 'px';
  surface.convertToBlob({ type: 'image/png' }).then(blob => {
    const url = URL.createObjectURL(blob);
    img.onload = img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }).catch(() => { });
  return img;
}

// ---- Geometry -----------------------------------------------------------------
// Rings sit between a small hub and the board radius R with a constant gap.
function boardGeometry(R, ringCount) {
  const hubR = R * (ringCount >= 6 ? 0.16 : 0.18);
  const start = hubR + R * 0.04;
  const gapRatio = 0.17;
  const w = (R - start) / (ringCount + gapRatio * (ringCount - 1));
  const g = w * gapRatio;
  const rings = [];
  for (let k = 0; k < ringCount; k++) {
    const rIn = start + k * (w + g);
    rings.push({ rIn, rOut: rIn + w, mid: rIn + w / 2 });
  }
  return { R, hubR, w, g, rings, n: ringCount };
}

// RingSegment: one annular sector, centred on angle 0 = 12 o'clock in the ring's
// own frame, with a parallel gap of constant pixel width on both sides.
function segmentPath(rIn, rOut, index, gapPx) {
  const p = new Path2D();
  const c = index * STEP - Math.PI / 2;
  const half = STEP / 2;
  const go = gapPx > 0 ? (gapPx / 2) / rOut : 0;
  const gi = gapPx > 0 ? (gapPx / 2) / rIn : 0;
  p.arc(0, 0, rOut, c - half + go, c + half - go, false);
  p.arc(0, 0, rIn, c + half - gi, c - half + gi, true);
  p.closePath();
  return p;
}
function annulusPath(rIn, rOut) {
  const p = new Path2D();
  p.arc(0, 0, rOut, 0, TAU, false);
  p.moveTo(rIn, 0);
  p.arc(0, 0, rIn, 0, TAU, true);
  p.closePath();
  return p;
}

// ---- Procedural textures (deterministic, generated once per kind) ----------------
const Textures = {
  _cache: {},
  get(kind, g) {
    if (!kind) return null;
    if (this._cache[kind]) return this._cache[kind];
    const size = 192;
    const c = makeCanvas(size, size), x = c.getContext('2d');
    const r = makeRng('orbit-tex:' + kind);
    if (kind === 'grain' || kind === 'speckle') {
      const img = x.createImageData(size, size);
      for (let i = 0; i < size * size; i++) {
        const v = r();
        const dark = v < 0.5;
        const a = kind === 'speckle' ? (v < 0.04 || v > 0.985 ? 220 : 0) : Math.floor(Math.abs(v - 0.5) * 2 * 255);
        img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = dark ? 0 : 255;
        img.data[i * 4 + 3] = a;
      }
      x.putImageData(img, 0, 0);
    } else if (kind === 'paper') {
      for (let i = 0; i < 900; i++) {
        x.strokeStyle = r() < 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.5)';
        x.lineWidth = r.range(0.3, 0.9);
        const px = r() * size, py = r() * size, a = r() * TAU, l = r.range(2, 9);
        x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke();
      }
    } else if (kind === 'halftone') {
      x.fillStyle = 'rgba(0,0,0,1)';
      const s = 5;
      for (let yy = 0; yy < size; yy += s) for (let xx = 0; xx < size; xx += s) {
        const off = ((yy / s) % 2) * s / 2;
        x.beginPath(); x.arc(xx + off, yy, 1.05, 0, TAU); x.fill();
      }
    } else if (kind === 'lines') {
      x.strokeStyle = 'rgba(255,255,255,1)';
      x.lineWidth = 0.6;
      for (let i = -size; i < size * 2; i += 3) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + size, size); x.stroke(); }
    } else if (kind === 'crackle') {
      x.strokeStyle = 'rgba(0,0,0,0.9)';
      x.lineWidth = 0.5;
      for (let i = 0; i < 26; i++) {
        let px = r() * size, py = r() * size;
        x.beginPath(); x.moveTo(px, py);
        for (let j = 0; j < 5; j++) { px += r.range(-22, 22); py += r.range(-22, 22); x.lineTo(px, py); }
        x.stroke();
      }
    } else if (kind === 'brushed') {
      return null; // drawn as concentric hairlines instead (see brushedDisc)
    }
    const pat = g.createPattern(c, 'repeat');
    this._cache[kind] = pat;
    return pat;
  },
  // Concentric brushing for metal: rotation invariant, so it never needs re-drawing.
  brushedDisc(R, pr) {
    const key = 'brushed:' + Math.round(R * pr);
    if (this._cache[key]) return this._cache[key];
    const S = Math.ceil(R * 2 * pr);
    const c = makeCanvas(S, S), x = c.getContext('2d');
    x.setTransform(pr, 0, 0, pr, S / 2, S / 2);
    const r = makeRng('orbit-brush');
    for (let rr = R * 0.15; rr < R; rr += 0.55) {
      const v = r();
      x.strokeStyle = v < 0.5 ? 'rgba(0,0,0,' + (0.25 * r()).toFixed(3) + ')' : 'rgba(255,255,255,' + (0.3 * r()).toFixed(3) + ')';
      x.lineWidth = 0.45;
      x.beginPath(); x.arc(0, 0, rr, 0, TAU); x.stroke();
    }
    this._cache[key] = c;
    return c;
  }
};

// ---- Ground (background) ---------------------------------------------------------
// Cached per theme and viewport: base tone, light behind the board, ambient
// shadow, vignette, a quiet engineering pattern and grain.
function paintGround(x, theme, W, H, cx, cy, R) {
  const bg = theme.bg;
  x.fillStyle = bg.base.css;
  x.fillRect(0, 0, W, H);

  const far = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy));
  let gr = x.createRadialGradient(cx, cy, R * 0.2, cx, cy, far);
  gr.addColorStop(0, bg.lift.css);
  gr.addColorStop(0.55, bg.base.css);
  gr.addColorStop(1, bg.deep.css);
  x.fillStyle = gr; x.fillRect(0, 0, W, H);

  // Faint coloured light behind the sculpture.
  gr = x.createRadialGradient(cx, cy, R * 0.4, cx, cy, R * 1.65);
  gr.addColorStop(0, rgba(bg.glow, bg.glowAlpha));
  gr.addColorStop(1, rgba(bg.glow, 0));
  x.fillStyle = gr; x.fillRect(0, 0, W, H);

  // Ambient shadow, cast away from the light.
  const la = theme.light.angle;
  const sx = cx - Math.cos(la) * R * 0.035, sy = cy - Math.sin(la) * R * 0.035 + R * 0.02;
  gr = x.createRadialGradient(sx, sy, R * 0.9, sx, sy, R * 1.16);
  const sh = bg.light ? 0.13 : 0.42;
  gr.addColorStop(0, 'rgba(0,0,0,' + sh + ')');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = gr;
  x.beginPath(); x.arc(sx, sy, R * 1.16, 0, TAU); x.fill();

  // Engineering pattern.
  const ink = theme.ink;
  const pa = bg.light ? 0.10 : 0.075;
  x.save();
  x.translate(cx, cy);
  x.lineWidth = 0.8;
  x.strokeStyle = rgba(ink, pa);
  x.fillStyle = rgba(ink, pa * 1.6);
  if (bg.pattern === 'orbits') {
    [1.13, 1.34, 1.72].forEach((m, i) => {
      x.beginPath(); x.arc(0, 0, R * m, 0, TAU); x.stroke();
      const a = -0.6 + i * 2.1;
      x.beginPath(); x.arc(Math.cos(a) * R * m, Math.sin(a) * R * m, 1.6 + i * 0.4, 0, TAU); x.fill();
    });
  } else if (bg.pattern === 'ticks') {
    for (let i = 0; i < 120; i++) {
      const a = i / 120 * TAU - Math.PI / 2;
      const major = i % 10 === 5; // segment boundaries sit half a step from slot centres
      const r0 = R * 1.085, r1 = R * (major ? 1.13 : 1.1);
      x.globalAlpha = major ? 1.4 : 0.7;
      x.beginPath(); x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); x.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); x.stroke();
    }
    x.globalAlpha = 1;
  } else if (bg.pattern === 'grid') {
    const s = Math.max(14, R * 0.09);
    for (let gx = -cx + (cx % s); gx < W - cx; gx += s) for (let gy = -cy + (cy % s); gy < H - cy; gy += s) {
      const d = Math.hypot(gx, gy);
      if (d < R * 1.1) continue;
      x.globalAlpha = Math.min(1, (d - R * 1.1) / (R * 0.6));
      x.fillRect(gx - 0.6, gy - 0.6, 1.2, 1.2);
    }
    x.globalAlpha = 1;
  } else if (bg.pattern === 'rays') {
    for (let i = 0; i < SEGMENTS; i++) {
      const a = (i + 0.5) * STEP - Math.PI / 2;
      const g2 = x.createLinearGradient(Math.cos(a) * R * 1.08, Math.sin(a) * R * 1.08, Math.cos(a) * R * 2.2, Math.sin(a) * R * 2.2);
      g2.addColorStop(0, rgba(ink, pa * 1.3)); g2.addColorStop(1, rgba(ink, 0));
      x.strokeStyle = g2;
      x.beginPath(); x.moveTo(Math.cos(a) * R * 1.08, Math.sin(a) * R * 1.08); x.lineTo(Math.cos(a) * R * 2.2, Math.sin(a) * R * 2.2); x.stroke();
    }
  }
  // Every ground carries the index: a fine mark at 12 o'clock and twelve dots at
  // slot centres, so the 30-degree grid is always readable.
  x.fillStyle = rgba(ink, bg.light ? 0.32 : 0.26);
  for (let i = 0; i < SEGMENTS; i++) {
    const a = i * STEP - Math.PI / 2;
    x.beginPath(); x.arc(Math.cos(a) * R * 1.045, Math.sin(a) * R * 1.045, i === 0 ? 0 : 1, 0, TAU); x.fill();
  }
  x.fillStyle = rgba(ink, bg.light ? 0.7 : 0.6);
  x.beginPath();
  x.moveTo(0, -R * 1.032); x.lineTo(-R * 0.018, -R * 1.068); x.lineTo(R * 0.018, -R * 1.068);
  x.closePath(); x.fill();
  x.restore();

  // Vignette.
  gr = x.createRadialGradient(cx, cy, Math.min(W, H) * 0.45, cx, cy, far * 1.05);
  gr.addColorStop(0, 'rgba(0,0,0,0)');
  gr.addColorStop(1, bg.light ? 'rgba(60,40,20,0.10)' : 'rgba(0,0,0,0.38)');
  x.fillStyle = gr; x.fillRect(0, 0, W, H);

  const grain = Textures.get('grain', x);
  if (grain) { x.globalAlpha = bg.grain; x.fillStyle = grain; x.fillRect(0, 0, W, H); x.globalAlpha = 1; }
}

// ---- The board -----------------------------------------------------------------------
// scene = { ringCount, angles[], families(k,i), selected, aligned[], flash[], complete, completeT,
//           dimOthers, hint }
function createBoardPainter() {
  const P = { geom: null, paths: null, annuli: null, key: '' };

  P.prepare = function (R, ringCount, theme) {
    const sepScale = clamp(R / 170, 0.7, 1.6);
    const sep = theme.sep;
    const gapPx = (sep.style === 'hairline' || sep.style === 'metal') ? 0.5 : sep.width * sepScale;
    const key = R.toFixed(2) + '|' + ringCount + '|' + gapPx.toFixed(2);
    if (key === P.key) return P.geom;
    P.key = key;
    P.geom = boardGeometry(R, ringCount);
    P.paths = P.geom.rings.map(ring => { const a = []; for (let i = 0; i < SEGMENTS; i++) a.push(segmentPath(ring.rIn, ring.rOut, i, gapPx)); return a; });
    P.annuli = P.geom.rings.map(ring => annulusPath(ring.rIn - 1, ring.rOut + 1));
    P.disc = annulusPath(P.geom.rings[0].rIn - 1, R + 1);
    P.sepScale = sepScale;
    return P.geom;
  };

  // Paint the rings into `x`, whose origin is the board centre (CSS px units).
  P.paint = function (x, theme, scene, pr) {
    const geom = P.geom, n = geom.n, R = geom.R;
    const m = theme.material;
    const pal = theme.paletteFor(n);
    const la = theme.light.angle, li = theme.light.intensity;

    // 1. OrbitRing base colour, segment by segment.
    for (let k = 0; k < n; k++) {
      x.save();
      x.rotate(scene.angles[k]);
      x.globalAlpha = m.alpha;
      for (let i = 0; i < SEGMENTS; i++) {
        x.fillStyle = pal[k][scene.families(k, i)].css;
        x.fill(P.paths[k][i]);
      }
      if (m.misregister) {
        // Print: a second, slightly shifted impression darkens one edge.
        x.globalAlpha = 0.28;
        x.translate(0.9, 0.7);
        for (let i = 0; i < SEGMENTS; i++) { x.fillStyle = pal[k][scene.families(k, i)].css; x.fill(P.paths[k][i]); }
      }
      if (m.pool) {
        // Watercolour: pigment pools at the edge of each wash.
        x.globalAlpha = 0.42;
        x.lineWidth = 1.3;
        for (let i = 0; i < SEGMENTS; i++) {
          const c = pal[k][scene.families(k, i)];
          x.strokeStyle = colour(c.L - 0.14, c.C * 1.1, c.h).css;
          x.stroke(P.paths[k][i]);
        }
      }
      x.restore();
    }

    // Everything below only touches pixels already painted.
    x.globalCompositeOperation = 'source-atop';

    // 2. Bevel: each ring reads as a turned, rounded band. One radial gradient
    // covers every ring (stops per ring), so it costs a single fill.
    {
      const gr = x.createRadialGradient(0, 0, 0, 0, 0, R + 1);
      const b = m.bevel, f = r => clamp(r / (R + 1), 0, 1);
      const W = (a) => 'rgba(255,255,255,' + a.toFixed(3) + ')', K = (a) => 'rgba(0,0,0,' + a.toFixed(3) + ')';
      for (let k = 0; k < n; k++) {
        const ring = geom.rings[k], w = ring.rOut - ring.rIn;
        const at = u => f(ring.rIn + w * u);
        if (b >= 0) {
          gr.addColorStop(at(0), K(b * 0.75)); gr.addColorStop(at(0.22), K(0));
          gr.addColorStop(at(0.62), W(m.gloss * 0.55)); gr.addColorStop(at(0.9), W(0));
          gr.addColorStop(at(1), K(b * 0.35));
        } else {
          gr.addColorStop(at(0), W(-b * 0.35)); gr.addColorStop(at(0.5), K(-b * 0.6)); gr.addColorStop(at(1), W(-b * 0.25));
        }
      }
      x.fillStyle = gr;
      x.fill(P.disc);
    }

    // 3. Directional light across the whole sculpture (fixed in world space).
    const lx = Math.cos(la) * R, ly = Math.sin(la) * R;
    let lg = x.createLinearGradient(lx, ly, -lx, -ly);
    lg.addColorStop(0, 'rgba(255,255,255,' + (0.13 * li).toFixed(3) + ')');
    lg.addColorStop(0.5, 'rgba(255,255,255,0)');
    lg.addColorStop(1, 'rgba(0,0,0,' + (0.2 * li).toFixed(3) + ')');
    x.fillStyle = lg;
    x.fill(P.disc);

    // 4. Sheen.
    if (m.sheen && typeof x.createConicGradient === 'function') {
      if (m.sheen === 'brushed') {
        const cg = x.createConicGradient(la, 0, 0);
        for (let i = 0; i <= 8; i++) cg.addColorStop(i / 8, i % 2 ? 'rgba(0,0,0,0.16)' : 'rgba(255,255,255,0.22)');
        x.fillStyle = cg; x.fill(P.disc);
        const disc = Textures.brushedDisc(R, pr);
        x.globalAlpha = 0.9;
        x.drawImage(disc, -R, -R, R * 2, R * 2);
        x.globalAlpha = 1;
      } else if (m.sheen === 'opal' || m.sheen === 'holo') {
        const reps = m.sheen === 'holo' ? 3 : 1;
        const a = m.sheen === 'holo' ? 0.17 : 0.13;
        for (let k = 0; k < n; k++) {
          // The sheen turns faster than the ring, so colour slides as you rotate.
          const cg = x.createConicGradient(scene.angles[k] * 1.7 + k * 0.9, 0, 0);
          const stops = 6 * reps;
          for (let i = 0; i <= stops; i++) cg.addColorStop(i / stops, 'hsla(' + Math.round(i / stops * 360 * reps) + ',90%,70%,' + a + ')');
          x.fillStyle = cg;
          x.fill(P.annuli[k]);
        }
      } else if (m.sheen === 'velvet') {
        const cg = x.createConicGradient(la + Math.PI / 2, 0, 0);
        cg.addColorStop(0, 'rgba(255,255,255,0.08)'); cg.addColorStop(0.5, 'rgba(0,0,0,0.12)'); cg.addColorStop(1, 'rgba(255,255,255,0.08)');
        x.fillStyle = cg; x.fill(P.disc);
      }
    }

    // 5. Texture.
    if (m.texture && m.texture !== 'brushed' && m.texAlpha > 0) {
      const pat = Textures.get(m.texture, x);
      if (pat) { x.globalAlpha = m.texAlpha; x.fillStyle = pat; x.fill(P.disc); x.globalAlpha = 1; }
    }

    // 6. Specular highlight: a soft reflection of the light source.
    if (m.spec > 0) {
      const hx = Math.cos(la) * R * 0.58, hy = Math.sin(la) * R * 0.58;
      const sg = x.createRadialGradient(hx, hy, 0, hx, hy, R * 0.62);
      sg.addColorStop(0, 'rgba(255,255,255,' + (m.spec * 0.42 * li).toFixed(3) + ')');
      sg.addColorStop(1, 'rgba(255,255,255,0)');
      x.fillStyle = sg; x.fill(P.disc);
    }

    // 7. Selection depth: other rings recede, but only slightly. Colours are
    // compared across rings, so a selection must never change how they read.
    if (scene.selected > 0 && scene.dimOthers > 0 && !(scene.focusT > 0.05)) {
      x.fillStyle = rgba(theme.bg.base, 0.12 * scene.dimOthers);
      const sel = geom.rings[scene.selected];
      const p = new Path2D();
      p.arc(0, 0, R + 1, 0, TAU);
      p.moveTo(sel.rOut + 1, 0); p.arc(0, 0, sel.rOut + 1, 0, TAU, true);
      p.moveTo(sel.rIn - 1, 0); p.arc(0, 0, sel.rIn - 1, 0, TAU);
      x.fill(p, 'evenodd');
    }

    // 8. Completion light.
    if (scene.completeT > 0 && scene.completeT < 1) paintCompletion(x, theme, geom, scene);

    x.globalCompositeOperation = 'source-over';

    // 9. Separators that are drawn, not cut.
    const sep = theme.sep;
    if (sep.style === 'hairline' || sep.style === 'metal' || sep.style === 'engraved') {
      for (let k = 0; k < n; k++) {
        const ring = geom.rings[k];
        x.save(); x.rotate(scene.angles[k]);
        x.beginPath();
        for (let i = 0; i < SEGMENTS; i++) {
          const a = i * STEP - STEP / 2 - Math.PI / 2;
          x.moveTo(Math.cos(a) * ring.rIn, Math.sin(a) * ring.rIn);
          x.lineTo(Math.cos(a) * ring.rOut, Math.sin(a) * ring.rOut);
        }
        if (sep.style === 'engraved') {
          // A light catch on one lip of every cut.
          x.strokeStyle = 'rgba(255,255,255,0.10)';
          x.lineWidth = 0.6;
          x.translate(Math.cos(la) * 0.9, Math.sin(la) * 0.9);
        } else {
          x.strokeStyle = sep.colour.css;
          x.lineWidth = sep.width * P.sepScale * (sep.style === 'metal' ? 0.75 : 0.6);
        }
        x.stroke();
        x.restore();
      }
    }

    // 10. Rims: a fine lit edge outside, a shadowed edge inside.
    for (let k = 0; k < n; k++) {
      const ring = geom.rings[k];
      if (sep.style === 'metal') {
        x.strokeStyle = sep.colour.css; x.lineWidth = sep.width * P.sepScale * 0.6;
        x.beginPath(); x.arc(0, 0, ring.rOut, 0, TAU); x.stroke();
        x.beginPath(); x.arc(0, 0, ring.rIn, 0, TAU); x.stroke();
      }
      if (m.rim > 0) {
        const rg = x.createLinearGradient(lx, ly, -lx, -ly);
        rg.addColorStop(0, 'rgba(255,255,255,' + (m.rim * 0.9).toFixed(3) + ')');
        rg.addColorStop(0.5, 'rgba(255,255,255,' + (m.rim * 0.2).toFixed(3) + ')');
        rg.addColorStop(1, 'rgba(255,255,255,0)');
        x.strokeStyle = rg; x.lineWidth = 0.8;
        x.beginPath(); x.arc(0, 0, ring.rOut - 0.4, 0, TAU); x.stroke();
        if (m.alpha < 1) { x.beginPath(); x.arc(0, 0, ring.rIn + 0.4, 0, TAU); x.stroke(); }
      }
    }

    // 11. Family highlight: every segment of one colour family, outlined, so a
    // match can be checked by eye rather than by memory.
    const ink = theme.ink;
    if (scene.famFocus && scene.famFocus.a > 0.01) {
      const ff = scene.famFocus;
      x.lineJoin = 'round';
      for (let k = 0; k < n; k++) {
        x.save(); x.rotate(scene.angles[k]);
        for (let i = 0; i < SEGMENTS; i++) {
          if (scene.families(k, i) !== ff.fam) continue;
          x.strokeStyle = 'rgba(0,0,0,' + (0.45 * ff.a).toFixed(3) + ')'; x.lineWidth = 4; x.stroke(P.paths[k][i]);
          x.strokeStyle = rgba(theme.bg.light ? colour(0.15, 0, 0) : colour(1, 0, 0), 0.95 * ff.a); x.lineWidth = 1.8; x.stroke(P.paths[k][i]);
        }
        x.restore();
      }
    }
    // 12. Selection rim, in the interface ink.
    if (scene.selected > 0) {
      const ring = geom.rings[scene.selected];
      const s = scene.selectT;
      x.strokeStyle = rgba(ink, 0.85 * s);
      x.lineWidth = 1.4;
      x.beginPath(); x.arc(0, 0, ring.rOut + 1.2, 0, TAU); x.stroke();
      x.strokeStyle = rgba(ink, 0.3 * s);
      x.lineWidth = 0.8;
      x.beginPath(); x.arc(0, 0, ring.rIn - 1.2, 0, TAU); x.stroke();
    }
  };
  return P;
}

function paintCompletion(x, theme, geom, scene) {
  const t = scene.completeT, R = geom.R, n = geom.n;
  const style = theme.completion;
  if (style === 'radiance') {
    const r = lerp(geom.hubR * 0.6, R * 1.25, easeInOutSine(t));
    const w = R * 0.32;
    const gr = x.createRadialGradient(0, 0, Math.max(0, r - w), 0, 0, r + w * 0.25);
    const a = 0.55 * (1 - t * 0.55);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.8, 'rgba(255,255,255,' + a.toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr;
    x.beginPath(); x.arc(0, 0, R + 2, 0, TAU); x.fill();
  } else if (style === 'sweep' && typeof x.createConicGradient === 'function') {
    const head = -Math.PI / 2 + easeInOutSine(t) * TAU;
    const cg = x.createConicGradient(head - 1.2, 0, 0);
    const a = 0.5 * Math.sin(Math.PI * t) + 0.1;
    cg.addColorStop(0, 'rgba(255,255,255,0)');
    cg.addColorStop(0.19, 'rgba(255,255,255,' + a.toFixed(3) + ')');
    cg.addColorStop(0.2, 'rgba(255,255,255,0)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = cg;
    x.beginPath(); x.arc(0, 0, R + 2, 0, TAU); x.fill();
  } else if (style === 'chime') {
    for (let k = 0; k < n; k++) {
      const c = k / n * 0.7, d = Math.abs(t - c - 0.12);
      const a = Math.max(0, 1 - d / 0.14) * 0.5;
      if (a <= 0) continue;
      const ring = geom.rings[k];
      x.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      x.beginPath(); x.arc(0, 0, ring.rOut, 0, TAU); x.arc(0, 0, ring.rIn, 0, TAU, true); x.fill();
    }
  } else {
    // bloom
    const a = 0.42 * Math.sin(Math.PI * Math.min(1, t * 1.3));
    const gr = x.createRadialGradient(0, 0, 0, 0, 0, R);
    gr.addColorStop(0, 'rgba(255,255,255,' + a.toFixed(3) + ')');
    gr.addColorStop(1, 'rgba(255,255,255,' + (a * 0.3).toFixed(3) + ')');
    x.fillStyle = gr;
    x.beginPath(); x.arc(0, 0, R + 2, 0, TAU); x.fill();
  }
}

// The hub: the mechanical axis. A small machined disc with an orbit mark whose
// planet travels a third of the way round with each stage; three ticks mark them.
function paintHub(x, theme, geom, orbitA, completeGlow) {
  const h = geom.hubR;
  const t = theme.hubTone, light = theme.bg.light;
  const la = theme.light.angle;
  x.save();
  // seat shadow
  x.fillStyle = light ? 'rgba(0,0,0,0.10)' : 'rgba(0,0,0,0.45)';
  x.beginPath(); x.arc(0, h * 0.04, h * 1.04, 0, TAU); x.fill();
  const g = x.createRadialGradient(Math.cos(la) * h * 0.5, Math.sin(la) * h * 0.5, h * 0.05, 0, 0, h);
  g.addColorStop(0, colour(t.L + (light ? 0.05 : 0.09), t.C, t.h).css);
  g.addColorStop(1, colour(t.L - (light ? 0.05 : 0.06), t.C, t.h).css);
  x.fillStyle = g;
  x.beginPath(); x.arc(0, 0, h, 0, TAU); x.fill();
  // turned rings
  x.lineWidth = 0.6;
  for (let i = 1; i <= 3; i++) {
    x.strokeStyle = i % 2 ? 'rgba(255,255,255,' + (light ? 0.5 : 0.06) + ')' : 'rgba(0,0,0,' + (light ? 0.08 : 0.25) + ')';
    x.beginPath(); x.arc(0, 0, h * (0.62 + i * 0.1), 0, TAU); x.stroke();
  }
  // lit rim
  const rg = x.createLinearGradient(Math.cos(la) * h, Math.sin(la) * h, -Math.cos(la) * h, -Math.sin(la) * h);
  rg.addColorStop(0, 'rgba(255,255,255,' + (light ? 0.9 : 0.35) + ')');
  rg.addColorStop(1, 'rgba(255,255,255,0)');
  x.strokeStyle = rg; x.lineWidth = 1;
  x.beginPath(); x.arc(0, 0, h - 0.5, 0, TAU); x.stroke();
  // orbit mark
  const ink = theme.ink;
  const or = h * 0.36;
  x.strokeStyle = rgba(ink, 0.55 + completeGlow * 0.4);
  x.lineWidth = 1;
  x.beginPath(); x.arc(0, 0, or, 0, TAU); x.stroke();
  for (let j = 0; j < 3; j++) {
    const ta = -Math.PI / 2 + j * TAU / 3;
    x.beginPath(); x.moveTo(Math.cos(ta) * or * 0.78, Math.sin(ta) * or * 0.78); x.lineTo(Math.cos(ta) * or * 1.22, Math.sin(ta) * or * 1.22); x.stroke();
  }
  x.fillStyle = rgba(ink, 0.9);
  x.beginPath(); x.arc(0, 0, h * 0.06, 0, TAU); x.fill();
  const pa = orbitA - Math.PI / 2;
  x.fillStyle = completeGlow > 0 ? theme.accent.css : rgba(ink, 0.95);
  x.beginPath(); x.arc(Math.cos(pa) * or, Math.sin(pa) * or, h * 0.085 + completeGlow * h * 0.025, 0, TAU); x.fill();
  x.restore();
}

// Hint: three chevrons on the ring near 12 o'clock, travelling the way to turn.
function paintHint(x, theme, geom, hint, now) {
  if (!hint) return;
  const ring = geom.rings[hint.ring];
  const ph = (now / 900) % 1;
  const col = theme.bg.light ? colour(0.18, 0, 0) : colour(1, 0, 0);
  const s = Math.max(3.5, Math.min(7, geom.w * 0.26));
  x.save();
  x.lineWidth = 2; x.lineCap = 'round'; x.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    const u = (i + ph) / 3;                         // 0..1 along the run
    const a = (hint.a === undefined ? -Math.PI / 2 : hint.a) + hint.dir * (-0.3 + u * 0.6);
    const alpha = Math.sin(Math.PI * u) * hint.alpha;
    const px = Math.cos(a) * ring.mid, py = Math.sin(a) * ring.mid;
    const tx = -Math.sin(a) * hint.dir, ty = Math.cos(a) * hint.dir; // direction of travel
    const nx = Math.cos(a), ny = Math.sin(a);
    x.strokeStyle = rgba(col, Math.max(0, alpha) * 0.9);
    x.beginPath();
    x.moveTo(px - tx * s * 0.5 + nx * s * 0.8, py - ty * s * 0.5 + ny * s * 0.8);
    x.lineTo(px + tx * s * 0.5, py + ty * s * 0.5);
    x.lineTo(px - tx * s * 0.5 - nx * s * 0.8, py - ty * s * 0.5 - ny * s * 0.8);
    x.stroke();
  }
  x.restore();
}

// ---- Intersection clues ----------------------------------------------------------------
// Each revealed condition has a marker on the rim at its column and a pin on
// every ring it reads. Pins are fixed in the world: they frame whatever segment
// is passing beneath. Markers carry the rule's glyph and its state:
//   revealed  new, never yet satisfied: a slow halo breathes around it
//   unsolved  held before, broken now: outline with a partial-progress arc
//   solved    filled with the interface ink
function clueGeom(geom) {
  const R = geom.R;
  return { Rm: R * 1.135, mr: clamp(R * 0.064, 8.5, 15) };
}
function colAngle(pos) { return pos * STEP - Math.PI / 2; }

function paintGlyph(x, type, cx, cy, s, fill, swatch) {
  x.save();
  x.translate(cx, cy);
  x.fillStyle = fill; x.strokeStyle = fill; x.lineWidth = Math.max(1, s * 0.16); x.lineCap = 'round'; x.lineJoin = 'round';
  const dot = (px, py, r, hollow) => { x.beginPath(); x.arc(px, py, r, 0, TAU); hollow ? x.stroke() : x.fill(); };
  const d = s * 0.22;
  switch (type) {
    case 'triple': dot(0, -s * 0.36, d); dot(-s * 0.36, s * 0.26, d); dot(s * 0.36, s * 0.26, d); break;
    case 'pair': dot(-s * 0.44, 0, d); dot(0, 0, d); dot(s * 0.44, 0, d * 0.9, true); break;
    case 'contrast':
      x.beginPath(); x.arc(0, 0, s * 0.5, 0, TAU); x.stroke();
      x.beginPath(); x.arc(0, 0, s * 0.5, -Math.PI / 2, Math.PI / 2); x.closePath(); x.fill(); break;
    case 'odd':
      dot(-s * 0.46, s * 0.12, d); dot(-s * 0.08, s * 0.12, d);
      x.beginPath(); x.moveTo(s * 0.4, -s * 0.24); x.lineTo(s * 0.62, s * 0.0); x.lineTo(s * 0.4, s * 0.24); x.lineTo(s * 0.18, 0); x.closePath(); x.fill(); break;
    case 'sequence':
      [-1, 0, 1].forEach(j => { const h = s * (0.32 + (j + 1) * 0.22); x.fillRect(j * s * 0.36 - s * 0.1, s * 0.45 - h, s * 0.2, h); }); break;
    case 'missing':
      if (swatch) { x.fillStyle = swatch; x.beginPath(); x.arc(0, 0, s * 0.5, 0, TAU); x.fill(); }
      x.strokeStyle = fill; x.beginPath(); x.arc(0, 0, s * 0.5, 0, TAU); x.stroke();
      x.beginPath(); x.moveTo(-s * 0.46, s * 0.46); x.lineTo(s * 0.46, -s * 0.46); x.stroke(); break;
    case 'alldiff':
      x.beginPath(); x.moveTo(-s * 0.5, -s * 0.18); x.lineTo(s * 0.5, -s * 0.18); x.moveTo(-s * 0.5, s * 0.18); x.lineTo(s * 0.5, s * 0.18);
      x.moveTo(s * 0.22, -s * 0.52); x.lineTo(-s * 0.22, s * 0.52); x.stroke(); break;
  }
  x.restore();
}

function paintClues(x, theme, geom, scene, now) {
  const ink = theme.ink, light = theme.bg.light;
  const cg = clueGeom(geom), Rm = cg.Rm, mr = cg.mr;
  const pal = theme.paletteFor(geom.n);
  const shadow = light ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.5)';

  // Focus: the rest of the board recedes behind the chosen column.
  if (scene.focusT > 0.01 && scene.focus >= 0 && scene.clues[scene.focus]) {
    const c = scene.clues[scene.focus], a = colAngle(c.pos), h = STEP / 2;
    const p = new Path2D();
    p.arc(0, 0, geom.R + 2, 0, TAU);
    p.moveTo(Math.cos(a - h) * geom.rings[0].rIn, Math.sin(a - h) * geom.rings[0].rIn);
    p.arc(0, 0, geom.R + 2, a - h, a + h);
    p.arc(0, 0, geom.rings[0].rIn, a + h, a - h, true);
    p.closePath();
    x.fillStyle = rgba(theme.bg.base, 0.42 * scene.focusT);
    x.fill(p, 'evenodd');
    x.strokeStyle = rgba(ink, 0.55 * scene.focusT); x.lineWidth = 1;
    x.beginPath(); x.arc(0, 0, geom.R + 2.5, a - h, a + h); x.arc(0, 0, geom.rings[0].rIn - 1.5, a + h, a - h, true); x.closePath(); x.stroke();
  }

  scene.clues.forEach((c, i) => {
    if (!c || c.appear <= 0.001) return;
    const a = colAngle(c.pos), ca = Math.cos(a), sa = Math.sin(a);
    const ap = easeOutCubic(clamp(c.appear, 0, 1));
    const focused = scene.focus === i;
    const solved = c.status === 'solved';
    const lit = Math.max(c.glow || 0, solved ? 1 : 0);

    // Pins.
    const pinR = clamp(geom.w * 0.2, 2.6, 5.5) * (0.4 + 0.6 * ap);
    c.rings.forEach((k, j) => {
      const ring = geom.rings[k], px = ca * ring.mid, py = sa * ring.mid;
      const diamond = c.type === 'odd' && j === c.odd;
      const shape = () => {
        x.beginPath();
        if (diamond) { const q = pinR * 1.35; x.moveTo(px, py - q); x.lineTo(px + q, py); x.lineTo(px, py + q); x.lineTo(px - q, py); x.closePath(); }
        else x.arc(px, py, pinR, 0, TAU);
      };
      x.globalAlpha = ap;
      shape(); x.strokeStyle = shadow; x.lineWidth = 3.2; x.stroke();
      shape(); x.strokeStyle = rgba(ink, solved ? 1 : 0.92); x.lineWidth = 1.5; x.stroke();
      if (solved) { x.fillStyle = rgba(ink, 0.95); x.beginPath(); x.arc(px, py, pinR * 0.32, 0, TAU); x.fill(); }
      x.globalAlpha = 1;
    });

    // A fine tick from the board edge to the marker.
    x.strokeStyle = rgba(ink, 0.35 * ap); x.lineWidth = 1;
    x.beginPath(); x.moveTo(ca * (geom.R + 2), sa * (geom.R + 2)); x.lineTo(ca * (Rm - mr - 1), sa * (Rm - mr - 1)); x.stroke();

    // Marker.
    const mx = ca * Rm, my = sa * Rm, r = mr * (0.6 + 0.4 * ap) * (focused ? 1.12 : 1);
    x.globalAlpha = ap;
    if (c.status === 'revealed' && !solved) {
      const ph = ((now - (c.revealAt || 0)) / 1800) % 1;
      x.strokeStyle = rgba(ink, 0.35 * (1 - ph)); x.lineWidth = 1;
      x.beginPath(); x.arc(mx, my, r * (1 + ph * 0.7), 0, TAU); x.stroke();
    }
    if (lit > 0.01) {
      const gr = x.createRadialGradient(mx, my, r * 0.6, mx, my, r * 2.4);
      gr.addColorStop(0, rgba(ink, 0.22 * lit)); gr.addColorStop(1, rgba(ink, 0));
      x.fillStyle = gr; x.beginPath(); x.arc(mx, my, r * 2.4, 0, TAU); x.fill();
    }
    x.fillStyle = solved ? rgba(ink, 0.96) : rgba(theme.bg.base, 0.9);
    x.beginPath(); x.arc(mx, my, r, 0, TAU); x.fill();
    if (!solved) {
      x.strokeStyle = rgba(ink, focused ? 0.9 : 0.5); x.lineWidth = 1;
      x.beginPath(); x.arc(mx, my, r, 0, TAU); x.stroke();
      if (c.progress > 0) {
        x.strokeStyle = rgba(ink, 0.95); x.lineWidth = 2;
        x.beginPath(); x.arc(mx, my, r, -Math.PI / 2, -Math.PI / 2 + TAU * c.progress); x.stroke();
      }
    }
    const swatch = c.type === 'missing' ? pal[geom.n - 1][c.fam].css : null;
    paintGlyph(x, c.type, mx, my, r * 1.05, solved ? theme.bg.base.css : rgba(ink, 0.95), swatch);
    if (focused) { x.strokeStyle = rgba(ink, 0.9); x.lineWidth = 1; x.beginPath(); x.arc(mx, my, r + 3.5, 0, TAU); x.stroke(); }
    x.globalAlpha = 1;
  });
}

// GameBoard: owns the main canvas, the ground cache and the offscreen board layer.
function createGameBoard(canvas, bgCanvas) {
  const g = canvas.getContext('2d');
  const bgx = bgCanvas ? bgCanvas.getContext('2d') : null;
  const B = {
    canvas, g, W: 1, H: 1, pr: 1, cx: 0, cy: 0, R: 100, bgKey: '', mainFull: true,
    painter: createBoardPainter(),
    groundCache: {},
    layer: null, lx: null
  };
  B.resize = function (W, H, pr, cx, cy, R) {
    B.W = W; B.H = H; B.pr = pr; B.cx = cx; B.cy = cy; B.R = R;
    const bw = Math.round(W * pr), bh = Math.round(H * pr);
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    if (bgCanvas) { if (bgCanvas.width !== bw) bgCanvas.width = bw; if (bgCanvas.height !== bh) bgCanvas.height = bh; }
    B.bgKey = ''; B.mainFull = true;
    B.groundCache = {};
    const S = Math.ceil((R * 2 + 16) * pr);
    if (!B.layer || B.layer.width !== S) { B.layer = makeCanvas(S, S); B.lx = B.layer.getContext('2d'); }
  };
  B.ground = function (theme) {
    const k = theme.key;
    if (B.groundCache[k]) return B.groundCache[k];
    const keys = Object.keys(B.groundCache);
    if (keys.length > 3) delete B.groundCache[keys[0]];
    const c = makeCanvas(B.W * B.pr, B.H * B.pr), x = c.getContext('2d');
    x.setTransform(B.pr, 0, 0, B.pr, 0, 0);
    paintGround(x, theme, B.W, B.H, B.cx, B.cy, B.R);
    B.groundCache[k] = c;
    return c;
  };
  // Draw one complete frame of `theme` (ground + board + hub) into the main canvas.
  // The ground lives on its own background canvas, so a normal frame only
  // repaints the square around the board. Transitions paint everything (full).
  B.drawScene = function (theme, scene, now, full) {
    const geom = B.painter.prepare(B.R, scene.ringCount, theme);
    g.setTransform(1, 0, 0, 1, 0, 0);
    if (full || !bgx) {
      g.drawImage(B.ground(theme), 0, 0);
      B.mainFull = true;
    } else {
      if (B.bgKey !== theme.key) {
        bgx.setTransform(1, 0, 0, 1, 0, 0);
        bgx.drawImage(B.ground(theme), 0, 0);
        B.bgKey = theme.key;
      }
      if (B.mainFull) { g.clearRect(0, 0, canvas.width, canvas.height); B.mainFull = false; }
      else {
        const e = B.R * 1.62 * B.pr;
        g.clearRect(Math.floor(B.cx * B.pr - e), Math.floor(B.cy * B.pr - e), Math.ceil(e * 2), Math.ceil(e * 2));
      }
    }
    // completion halo
    if (scene.completeGlow > 0) {
      g.setTransform(B.pr, 0, 0, B.pr, 0, 0);
      const gr = g.createRadialGradient(B.cx, B.cy, B.R * 0.9, B.cx, B.cy, B.R * 1.5);
      gr.addColorStop(0, rgba(theme.bg.glow, (theme.bg.light ? 0.35 : 0.14) * scene.completeGlow));
      gr.addColorStop(1, rgba(theme.bg.glow, 0));
      g.fillStyle = gr; g.fillRect(B.cx - B.R * 1.55, B.cy - B.R * 1.55, B.R * 3.1, B.R * 3.1);
    }
    const S = B.layer.width, x = B.lx;
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.clearRect(0, 0, S, S);
    x.setTransform(B.pr, 0, 0, B.pr, S / 2, S / 2);
    B.painter.paint(x, theme, scene, B.pr);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(B.layer, Math.round(B.cx * B.pr - S / 2), Math.round(B.cy * B.pr - S / 2));
    g.setTransform(B.pr, 0, 0, B.pr, B.cx * B.pr, B.cy * B.pr);
    if (scene.clues) paintClues(g, theme, geom, scene, now);
    paintHub(g, theme, geom, scene.orbitA, scene.completeGlow);
    if (scene.hint) paintHint(g, theme, geom, scene.hint, now);
    return geom;
  };
  // Theme reveal: the new universe opens out from the axis.
  B.drawTransition = function (fromTheme, fromScene, toTheme, toScene, t, now) {
    B.drawScene(fromTheme, fromScene, now, true);
    const far = Math.hypot(Math.max(B.cx, B.W - B.cx), Math.max(B.cy, B.H - B.cy));
    const r = easeInOutSine(t) * far;
    g.save();
    g.setTransform(B.pr, 0, 0, B.pr, 0, 0);
    g.beginPath(); g.arc(B.cx, B.cy, Math.max(0.1, r), 0, TAU); g.clip();
    B.drawScene(toTheme, toScene, now, true);
    g.restore();
    g.setTransform(B.pr, 0, 0, B.pr, 0, 0);
    g.strokeStyle = rgba(toTheme.ink, 0.5 * (1 - t));
    g.lineWidth = 1.2;
    g.beginPath(); g.arc(B.cx, B.cy, Math.max(0.1, r), 0, TAU); g.stroke();
  };
  return B;
}

// A solved, still miniature of a theme for the collection.
function renderThumbnail(theme, ringCount, sizeCss, pr, families) {
  const c = makeCanvas(sizeCss * pr, sizeCss * pr);
  const x = c.getContext('2d');
  x.setTransform(pr, 0, 0, pr, 0, 0);
  const R = sizeCss * 0.4;
  paintGround(x, theme, sizeCss, sizeCss, sizeCss / 2, sizeCss / 2, R);
  const painter = createBoardPainter();
  const geom = painter.prepare(R, ringCount, theme);
  const S = Math.ceil((R * 2 + 8) * pr);
  const layer = makeCanvas(S, S), lx = layer.getContext('2d');
  lx.setTransform(pr, 0, 0, pr, S / 2, S / 2);
  const angles = []; for (let k = 0; k < ringCount; k++) angles.push(0);
  painter.paint(lx, theme, { ringCount, angles, families: families || ((k, i) => i), selected: -1, completeT: 0 }, pr);
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.drawImage(layer, Math.round(sizeCss * pr / 2 - S / 2), Math.round(sizeCss * pr / 2 - S / 2));
  x.setTransform(pr, 0, 0, pr, sizeCss / 2 * pr, sizeCss / 2 * pr);
  paintHub(x, theme, geom, 0, 1);
  return c;
}
