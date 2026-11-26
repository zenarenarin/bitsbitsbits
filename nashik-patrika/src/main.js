/*
 * main.js — composites the painted cards for any moment t.
 *
 *   window.patrika.renderAt(t)   draw the frame at t seconds (deterministic)
 *   window.patrika.ready         true once fonts and paintings are done
 *
 * Opened directly in a browser (no ?render), it simply plays.
 */
(function () {
  const P = window.P, W = P.W_, TL = window.TIMELINE;
  const params = new URLSearchParams(location.search);
  P.SCALE = parseFloat(params.get('scale') || '1');
  const RENDER = params.has('render');
  const DEBUG = params.get('debug');

  const stage = document.getElementById('stage');
  const bg = document.getElementById('bg'), fg = document.getElementById('fg');
  const S = P.SCALE;
  for (const c of [bg, fg]) { c.width = 1080 * S; c.height = 1920 * S; }
  const bx = bg.getContext('2d'), fx = fg.getContext('2d');
  const tmpA = P.canvas(1080 * S, 1920 * S), ta = tmpA.getContext('2d');
  const tmpB = P.canvas(1080 * S, 1920 * S), tb = tmpB.getContext('2d');

  let cards, pages, glints;

  function setupGlints() {
    // a few points of light on the water, breathing very slowly
    const r = P.rng(77), out = [];
    for (let i = 0; i < 28; i++) {
      const y = 1462 + Math.pow(r(), 1.8) * 300;
      out.push({ x: -150 + r() * 1400, y, len: 14 + r() * 60 * (0.4 + (y - 1440) / 300), ph: r() * 6.28, w: 0.25 + r() * 0.35 });
    }
    return out;
  }

  function drawWater(t, u) {
    P.drawCard(bx, cards.water, u);
    // reflection with a slow, small horizontal ripple, deeper toward us
    ta.setTransform(1, 0, 0, 1, 0, 0);
    ta.clearRect(0, 0, tmpA.width, tmpA.height);
    P.drawCard(ta, cards.refl, u);
    tb.setTransform(1, 0, 0, 1, 0, 0);
    tb.globalCompositeOperation = 'source-over';
    tb.clearRect(0, 0, tmpB.width, tmpB.height);
    const y0 = 1425, y1 = 1800, step = 3;
    for (let y = y0; y < y1; y += step) {
      const k = (y - 1440) / 360;
      const amp = 0.3 + 3.2 * Math.max(0, k) * Math.max(0, k);
      const dx = amp * (0.6 * Math.sin(t * 0.85 + y * 0.23) + 0.4 * Math.sin(t * 0.47 - y * 0.071 + 1.3));
      tb.drawImage(tmpA, 0, y * S, tmpA.width, step * S, dx * S, y * S, tmpA.width, step * S);
    }
    // keep it inside the water
    tb.globalCompositeOperation = 'destination-in';
    P.drawCard(tb, cards.water, u);
    tb.globalCompositeOperation = 'source-over';
    bx.save();
    bx.setTransform(1, 0, 0, 1, 0, 0);
    bx.globalAlpha = 0.62;
    bx.drawImage(tmpB, 0, 0);
    bx.restore();
    // glints
    const k = P.CAM.f * P.CAM.T;
    bx.save();
    bx.setTransform(S, 0, 0, S, 0, 0);
    bx.globalCompositeOperation = 'screen';
    bx.lineCap = 'round';
    for (const g of glints) {
      const shift = u * k * ((g.y - P.CAM.yh) / (P.CAM.f * P.CAM.eye));
      const a = g.w * (0.5 + 0.5 * Math.sin(t * 0.6 + g.ph)) * 0.35;
      bx.strokeStyle = `rgba(246,236,214,${a})`;
      bx.lineWidth = 0.8 + (g.y - 1440) / 260;
      bx.beginPath();
      bx.moveTo(g.x - shift, g.y);
      bx.lineTo(g.x - shift + g.len, g.y - 0.5);
      bx.stroke();
    }
    bx.restore();
  }

  function renderAt(t) {
    const u = TL.progress(t);
    // ------------------------------------------------ background
    bx.setTransform(1, 0, 0, 1, 0, 0);
    bx.globalCompositeOperation = 'source-over';
    bx.globalAlpha = 1;
    bx.filter = 'none';
    bx.clearRect(0, 0, bg.width, bg.height);
    P.drawCard(bx, cards.sky, 0);
    P.drawCard(bx, cards.hills, u);
    drawWater(t, u);
    P.drawCard(bx, cards.far, u);
    P.drawCard(bx, cards.steps, u);
    P.drawCard(bx, cards.wall, u);
    // light: a faint warming over the whole piece
    const wa = TL.warm.amount * P.smooth(TL.warm.from, TL.warm.to, t);
    if (wa > 0.001) {
      bx.save();
      bx.setTransform(S, 0, 0, S, 0, 0);
      bx.globalCompositeOperation = 'soft-light';
      const g = bx.createRadialGradient(80, 1250, 50, 80, 1250, 1300);
      g.addColorStop(0, `rgba(250,190,110,${wa * 3})`);
      g.addColorStop(1, 'rgba(250,190,110,0)');
      bx.fillStyle = g;
      bx.fillRect(0, 1000, 1080, 920);
      bx.restore();
    }
    // morning haze lifting off the river
    const ma = TL.mistAlpha(t);
    if (ma > 0.001) {
      bx.save();
      bx.setTransform(S, 0, 0, S, 0, 0);
      const g = bx.createLinearGradient(0, 1000, 0, 1920);
      g.addColorStop(0, 'rgba(244,238,226,0)');
      g.addColorStop(0.3, `rgba(244,238,226,${ma})`);
      g.addColorStop(0.55, `rgba(244,238,226,${ma * 0.85})`);
      g.addColorStop(1, `rgba(244,238,226,${ma * 0.35})`);
      bx.fillStyle = g;
      bx.fillRect(0, 1000, 1080, 920);
      bx.restore();
    }
    // paper tooth over the painting
    grain(bx, 'multiply', 0.55);

    // ------------------------------------------------ foreground: the pier
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.clearRect(0, 0, fg.width, fg.height);
    const v = TL.velocity(t) * P.CAM.f * P.CAM.T / 0.9 / TL.fps; // px per frame
    const blur = Math.min(16, v * 0.33);
    const xc = W.pierCenterX(u);
    if (xc > -400 && xc < 1500) {
      P.drawCard(fx, cards.pier, u, { filter: blur >= 0.5 ? `url(#mb${Math.max(1, Math.round(blur))})` : "none" });
      grain(fx, 'source-atop', 0.6);
    }
    // ------------------------------------------------ text visibility
    // Page 1 remains wherever the pier has not yet passed; page 2 exists
    // wherever it has. The boundary is always behind the stone.
    pages[0].style.clipPath = `inset(0 ${Math.max(0, 1080 - xc).toFixed(2)}px 0 0)`;
    pages[1].style.clipPath = `inset(0 0 0 ${Math.max(0, Math.min(1080, xc)).toFixed(2)}px)`;
    pages[0].style.visibility = xc <= 0 ? 'hidden' : 'visible';
    pages[1].style.visibility = xc >= 1080 ? 'hidden' : 'visible';
  }

  let grainPat = null;
  function grain(ctx, op, alpha) {
    if (!grainPat) grainPat = ctx.createPattern(P.TEX.paper, 'repeat');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = op;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = grainPat;
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  function fit() {
    if (RENDER) return;
    const k = Math.min(window.innerWidth / 1080, window.innerHeight / 1920);
    stage.style.transform = `scale(${k})`;
  }

  async function init() {
    await document.fonts.load('40px "Tiro Devanagari Marathi"', 'शुभ विवाह');
    await document.fonts.ready;
    pages = window.buildPages(document.getElementById('type'));
    P.TEX = P.makeTextures(1234);
    cards = W.build();
    glints = setupGlints();
    window.patrika = { renderAt, ready: true, duration: TL.duration, fps: TL.fps, cards };
    fit();
    window.addEventListener('resize', fit);
    if (DEBUG) {
      renderAt(parseFloat(DEBUG));
      return;
    }
    if (!RENDER) {
      const t0 = performance.now();
      const loop = (now) => {
        const t = ((now - t0) / 1000) % TL.duration;
        renderAt(t);
        requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    }
  }
  init();
})();
