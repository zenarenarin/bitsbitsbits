/*
 * main.js — composites the patrika for any moment t.
 *   window.patrika.renderAt(t)  deterministic frame
 * The painting is made once; per frame only the river is drawn: reflections
 * that bend with the water, a surface that drifts with the current, a few
 * points of light, and one small boat that barely moves.
 */
(function () {
  const P = window.P, SC = P.SC, TL = window.TIMELINE;
  const params = new URLSearchParams(location.search);
  P.SCALE = parseFloat(params.get('scale') || '1');
  const S = P.SCALE, RENDER = params.has('render');
  const stage = document.getElementById('stage');
  const cv = document.getElementById('bg');
  cv.width = 1080 * S; cv.height = 1920 * S;
  const x = cv.getContext('2d');
  const tmp = P.canvas(1080 * S, 480 * S), tx = tmp.getContext('2d');
  let L, glints, grainPat;
  const WL = SC.WL, BOT = 1920;

  function river(t) {
    const [r0, r1] = TL.river.ripple;
    // reflections: each band of the far bank, mirrored, bent sideways by the
    // swell and slightly broken vertically — more so nearer to us
    tx.setTransform(1, 0, 0, 1, 0, 0);
    tx.clearRect(0, 0, tmp.width, tmp.height);
    const far = L.far, fy = far.by;
    const step = 2;
    for (let y = WL; y < BOT; y += step) {
      const k = (y - WL) / (BOT - WL);
      const amp = r0 + (r1 - r0) * k * k;
      const dx = amp * (0.62 * Math.sin(t * 0.72 + y * 0.21) + 0.38 * Math.sin(t * 0.41 - y * 0.067 + 1.7));
      const vy = (1.2 + 5 * k) * Math.sin(t * 0.55 + y * 0.13);
      const sy = WL - (y - WL) * 1.02 + vy; // source row in the far bank
      if (sy < fy || sy > fy + far.bh) continue;
      tx.drawImage(far.canvas, 0, (sy - fy) * S, far.canvas.width, step * S, dx * S, (y - WL) * S, far.canvas.width, step * S);
    }
    // tint toward the water and fade with distance from the bank
    tx.globalCompositeOperation = 'source-atop';
    const g = tx.createLinearGradient(0, 0, 0, (BOT - WL) * S);
    g.addColorStop(0, 'rgba(90,110,112,0.2)');
    g.addColorStop(1, 'rgba(45,85,82,0.55)');
    tx.fillStyle = g; tx.fillRect(0, 0, tmp.width, tmp.height);
    tx.globalCompositeOperation = 'destination-in';
    const f = tx.createLinearGradient(0, 0, 0, (BOT - WL) * S);
    f.addColorStop(0, 'rgba(0,0,0,0.85)');
    f.addColorStop(0.55, 'rgba(0,0,0,0.5)');
    f.addColorStop(1, 'rgba(0,0,0,0.12)');
    tx.fillStyle = f; tx.fillRect(0, 0, tmp.width, tmp.height);
    tx.globalCompositeOperation = 'source-over';
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalAlpha = 0.72;
    x.drawImage(tmp, 0, WL * S);
    x.restore();

    // the surface drifting with the current, faster nearer to us
    const st = L.streaks, [v0, v1] = TL.river.current;
    const band = 6;
    for (let y = WL; y < BOT; y += band) {
      const k = (y - WL) / (BOT - WL);
      const off = ((t * (v0 + (v1 - v0) * k)) % 1080 + 1080) % 1080;
      x.drawImage(st.canvas, (1080 - off) * S, (y - WL) * S, 1080 * S, band * S, 0, y * S, 1080 * S, band * S);
    }

    // light: a few glints in the glow's reflection, breathing slowly
    x.save(); x.setTransform(S, 0, 0, S, 0, 0);
    x.globalCompositeOperation = 'screen';
    x.lineCap = 'round';
    for (const gl of glints) {
      const a = gl.a * (0.5 + 0.5 * Math.sin(t * gl.w + gl.ph));
      x.strokeStyle = `rgba(250,232,196,${a})`;
      x.lineWidth = gl.lw;
      const sx = gl.x + ((t * gl.v) % 30);
      x.beginPath(); x.moveTo(sx, gl.y); x.lineTo(sx + gl.len, gl.y); x.stroke();
    }
    x.restore();

    // the boat, mid-river: it drifts a few pixels and lifts a fraction on the swell
    const b = L.boat, bx = 640 + TL.boat.drift * Math.sin((2 * Math.PI * t) / TL.boat.period), by = 1586 + 0.7 * Math.sin(t * 0.9);
    x.save(); x.setTransform(S, 0, 0, S, 0, 0);
    x.globalAlpha = 0.25;
    x.translate(bx, by + 38); x.scale(1, -0.8);
    x.drawImage(b.canvas, 0, -38, 110, 50);
    x.restore();
    x.save(); x.setTransform(S, 0, 0, S, 0, 0);
    x.drawImage(b.canvas, bx, by, 110, 50);
    x.restore();
  }

  function renderAt(t) {
    x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'source-over';
    x.globalAlpha = 1;
    x.drawImage(L.bg.canvas, 0, 0);
    river(t);
    P.drawCard(x, L.near, 0);
    if (!grainPat) grainPat = x.createPattern(P.TEX.paper, 'repeat');
    x.save(); x.setTransform(1, 0, 0, 1, 0, 0);
    x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.5;
    x.fillStyle = grainPat; x.fillRect(0, 0, cv.width, cv.height);
    x.restore();
  }

  function fit() {
    if (RENDER) return;
    stage.style.transform = `scale(${Math.min(innerWidth / 1080, innerHeight / 1920)})`;
  }

  async function init() {
    await document.fonts.load('40px "Tiro Devanagari Marathi"', 'शुभ विवाह');
    await document.fonts.ready;
    window.buildPatrika(document.getElementById('type'));
    P.TEX = P.makeTextures(1234);
    L = SC.build();
    const gr = P.rng(5);
    glints = [];
    for (let i = 0; i < 30; i++) glints.push({ x: 600 + gr() * 460, y: 1480 + Math.pow(gr(), 1.3) * 400, len: 6 + gr() * 26, lw: 0.8 + gr() * 1.4, a: 0.25 + gr() * 0.35, w: 0.35 + gr() * 0.5, ph: gr() * 6.3, v: 2 + gr() * 4 });
    window.patrika = { renderAt, ready: true, duration: TL.duration, fps: TL.fps };
    fit(); addEventListener('resize', fit);
    if (params.has('t')) { renderAt(parseFloat(params.get('t'))); return; }
    if (!RENDER) {
      const t0 = performance.now();
      const loop = (now) => { renderAt(((now - t0) / 1000) % TL.duration); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
  }
  init();
})();
