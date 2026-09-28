// Upstroke — one line climbs forever; tap to reverse its horizontal direction
// and thread it through the gaps in the falling bars.
window.plethoraBit = {
  meta: {
    title: "Upstroke",
    runtime: "plethora-bit@2",
    tags: ["arcade", "minimal", "one-tap", "reflex"],
    permissions: ["haptics", "backgroundMusic", "storage"]
  },

  async init(ctx) {
    const canvas = ctx.createCanvas2D({
      touchAction: "none",
      maxDpr: 2,
      coordinateSpace: "css",
      alpha: false,
      layer: "content"
    });
    const g = canvas.getContext("2d");
    const score = ctx.game.score({ initial: 0, min: 0 });

    const BG = "#05060a";
    const FONT = "system-ui, -apple-system, 'Segoe UI', sans-serif";
    const TAU = Math.PI * 2;
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const rand = (a, b) => a + Math.random() * (b - a);

    // ---------- creator tuning ----------
    const cfg = {};
    let rampCurve = null;
    function readTuning() {
      const t = ctx.tune;
      cfg.climb = t.number("climb_speed") ?? 0.55;
      cfg.turn = t.number("turn_speed") ?? 0.62;
      cfg.smoothMs = t.number("turn_smoothing_ms") ?? 400;
      cfg.startGap = t.percent("starting_gap") ?? 0.46;
      cfg.margin = t.number("hit_margin") ?? 2;
      cfg.lineColor = t.color("line_color") ?? "#8ff6ff";
      cfg.barColor = t.color("bar_color") ?? "#ff2d55";
      cfg.musicVol = t.percent("music_volume") ?? 0.35;
      rampCurve = t.has && t.has("difficulty_ramp") ? t.curve("difficulty_ramp") : null;
    }
    readTuning();
    ctx.tune.onChange(
      ["climb_speed", "turn_speed", "turn_smoothing_ms", "starting_gap", "hit_margin",
        "line_color", "bar_color", "music_volume", "difficulty_ramp"],
      () => {
        readTuning();
        if (music) try { music.setVolume(cfg.musicVol); } catch (e) {}
      }
    );
    function difficulty(sec) {
      if (rampCurve) return rampCurve.at(sec);
      // fallback ramp: 0 -> ~1.2 over four minutes, eased
      return 1.2 * (1 - Math.exp(-sec / 110));
    }

    // ---------- layout ----------
    let W = ctx.width, H = ctx.height, U = 1, tipY = 0, safe = ctx.safeArea || { top: 0, bottom: 0 };
    let unit = 1; // px of climb per displayed metre
    function layout(info) {
      const prevH = H || 1;
      W = Math.max(1, (info && info.width) || ctx.width);
      H = Math.max(1, (info && info.height) || ctx.height);
      safe = (info && info.safeArea) || ctx.safeArea || { top: 0, bottom: 0 };
      U = Math.min(W, 560);
      unit = U * 0.055;
      tipY = Math.round(Math.min(H * 0.66, H - (safe.bottom || 0) - 130));
      for (const b of bars) b.y *= H / prevH;
      line.x = clamp(line.x, WALL, W - WALL);
    }

    // ---------- state ----------
    const WALL = 5;
    const EDGE_HIT = 1.5;  // the line dies when its core touches a side edge
    const line = { x: 0, dir: 1, vx: 0, turnFrom: 0, turnT: -1 };
    let bars = [];
    let trail = [];        // { x, alt, t, turn }
    let rings = [];        // { alt, x, t }
    let parts = [];        // screen-space sparks
    let dust = [];
    let queue = [];        // pending bar specs from the pattern generator
    let mode = "attract";  // attract | play | over
    let altitude = 0;      // px climbed
    let clock = 0;         // seconds of sim time (always advances outside "over")
    let runTime = 0;       // seconds since run start
    let spawnIn = 0;
    let lastC = 0.5;
    let autoFlipIn = 0.8;
    let headPulse = 0;
    let curD = 0;          // current difficulty, drives the tip's heartbeat rate
    let emberIn = 0;
    // the tip changes colour every 200 m; index 0 is the tuned line colour
    const TIER_STEP = 200;
    const TIP_COLORS = [null, "#ffd36b", "#ff6bd6", "#9dff6b", "#b08bff", "#ff9a4d", "#6bb6ff", "#ffffff"];
    let tipTier = 0, tipBlend = 1, tipFrom = null;
    let deadAt = 0;
    let shake = 0;
    let overT = 0;
    let best = 0;
    let newBest = false;
    let run = 0;
    let disposed = false;
    let music = null;
    let lastIntensity = -1;
    let hintAlpha = 1;
    let vc = 0;            // current closing speed of bars (px/s)
    let runStartAlt = 0;   // altitude at which the current run began

    for (let i = 0; i < 48; i++) dust.push({ x: Math.random(), y: Math.random(), z: rand(0.15, 0.55), r: rand(0.5, 1.4) });

    layout();
    line.x = W * 0.5;
    line.vx = cfg.turn * U;

    if (ctx.capabilities && ctx.capabilities.storage) {
      try {
        Promise.resolve(ctx.storage.get("best")).then(v => {
          if (!disposed && typeof v === "number" && isFinite(v)) best = Math.max(best, v);
        }).catch(() => {});
      } catch (e) {}
    }

    ctx.onResize(layout, { immediate: true });
    ctx.onDestroy(() => { disposed = true; run += 1; });

    // ---------- helpers ----------
    function haptic(kind) {
      if (ctx.capabilities && ctx.capabilities.haptics) try { ctx.platform.haptic(kind); } catch (e) {}
    }
    function params(d) {
      const dc = clamp(d, 0, 1);
      return {
        vBar: U * (0.08 + 0.6 * d),
        spawnDt: lerp(1.35, 0.66, dc),
        gap: Math.max(0.105, cfg.startGap - (cfg.startGap - 0.13) * d),
        k: lerp(0.35, 0.85, dc),
        pattern: clamp((d - 0.12) / 0.7, 0, 1) * 0.55,
        drift: d > 0.55 ? Math.min(0.45, (d - 0.55) * 0.7) : 0
      };
    }
    const minGapN = () => Math.max(40 / W, 0.07);
    // path gaps keep this far (fraction of width) from the lethal edges, leaving
    // room for the wide turn arc to swing back without touching them
    const EDGE_C = 0.16;
    function reachN(dt, k) {
      return (cfg.turn * U * Math.max(0.12, dt - cfg.smoothMs / 2000) * k) / W;
    }

    // pattern generator: fills `queue` with { dt, gaps:[{l,r}], drift }
    function pushSingle(p, dt, shiftScale, wScale, drift) {
      const reach = reachN(dt, p.k * shiftScale);
      let c = lastC + rand(-1, 1) * reach;
      if (c < EDGE_C) c = 2 * EDGE_C - c;
      if (c > 1 - EDGE_C) c = 2 * (1 - EDGE_C) - c;
      c = clamp(c, EDGE_C, 1 - EDGE_C);
      const w = Math.max(minGapN(), p.gap * (wScale || rand(0.9, 1.18)));
      lastC = c;
      // a drifting gap must never slide into a (lethal) side edge
      if (drift) {
        drift.amp = Math.min(drift.amp, c - w / 2 - 0.04, 0.96 - c - w / 2);
        if (drift.amp < 0.03) drift = null;
      }
      queue.push({ dt, gaps: [{ l: c - w / 2, r: c + w / 2 }], drift: drift || null });
    }
    function refill(d) {
      const p = params(d);
      const early = runTime < 14;
      const roll = Math.random();
      if (early || roll > p.pattern) {
        // lone bar; early on, half of them are generous partial walls
        if (Math.random() < (early ? 0.5 : 0.18)) {
          const s = rand(0.3, 0.62);
          if (Math.random() < 0.5) { // solid on the left, open to the right
            queue.push({ dt: p.spawnDt, gaps: [{ l: s, r: 2 }] });
            lastC = clamp(Math.max(lastC, s + 0.1), s + 0.1, 1 - EDGE_C);
          } else {
            queue.push({ dt: p.spawnDt, gaps: [{ l: -1, r: 1 - s }] });
            lastC = clamp(Math.min(lastC, 1 - s - 0.1), EDGE_C, 1 - s - 0.1);
          }
          return;
        }
        const drift = Math.random() < p.drift
          ? { amp: rand(0.05, 0.12), freq: rand(0.35, 0.75), phase: rand(0, TAU) } : null;
        pushSingle(p, p.spawnDt * rand(0.9, 1.15), 1, 0, drift);
        return;
      }
      const kind = Math.floor(Math.random() * 5);
      const dc = clamp(d, 0, 1);
      if (kind === 0) { // zigzag: alternate sides, tight spacing
        const n = 3 + Math.floor(Math.random() * (1 + 2 * dc));
        const dt = p.spawnDt * lerp(0.78, 0.62, dc);
        let sgn = lastC > 0.5 ? -1 : 1;
        for (let i = 0; i < n; i++) {
          const reach = reachN(dt, p.k * 0.95);
          let c = clamp(lastC + sgn * reach * rand(0.75, 1), EDGE_C, 1 - EDGE_C);
          const w = Math.max(minGapN(), p.gap * 1.08);
          queue.push({ dt, gaps: [{ l: c - w / 2, r: c + w / 2 }] });
          lastC = c; sgn = -sgn;
        }
      } else if (kind === 1) { // stairs: keep drifting one way
        const n = 3 + Math.floor(Math.random() * 2);
        const dt = p.spawnDt * 0.8;
        let sgn = lastC > 0.5 ? -1 : 1;
        for (let i = 0; i < n; i++) {
          const reach = reachN(dt, p.k * 0.6);
          let c = lastC + sgn * reach;
          if (c < EDGE_C || c > 1 - EDGE_C) { sgn = -sgn; c = lastC + sgn * reach; }
          c = clamp(c, EDGE_C, 1 - EDGE_C);
          const w = Math.max(minGapN(), p.gap);
          queue.push({ dt, gaps: [{ l: c - w / 2, r: c + w / 2 }] });
          lastC = c;
        }
      } else if (kind === 2) { // needle: stacked gaps, flutter to hold the line
        pushSingle(p, p.spawnDt, 0.8, 1.25);
        const n = 1 + Math.floor(Math.random() * (1 + 2 * dc));
        const w = queue[queue.length - 1].gaps[0];
        for (let i = 0; i < n; i++) queue.push({ dt: p.spawnDt * 0.5, gaps: [{ l: w.l, r: w.r }] });
      } else if (kind === 3) { // choice: two gaps, one wide and far, one narrow and near
        const dt = p.spawnDt;
        const reach = reachN(dt, p.k);
        const near = clamp(lastC + rand(-0.3, 0.3) * reach, EDGE_C, 1 - EDGE_C);
        const far = near < 0.5 ? clamp(near + rand(0.35, 0.55), EDGE_C, 1 - EDGE_C) : clamp(near - rand(0.35, 0.55), EDGE_C, 1 - EDGE_C);
        const wn = Math.max(minGapN(), p.gap * 0.85), wf = Math.max(minGapN(), p.gap * 1.3);
        const gaps = [{ l: near - wn / 2, r: near + wn / 2 }, { l: far - wf / 2, r: far + wf / 2 }].sort((a, b) => a.l - b.l);
        if (gaps[0].r < gaps[1].l - 0.04) {
          queue.push({ dt, gaps });
          lastC = Math.abs(far - lastC) <= reach ? far : near;
        } else pushSingle(p, dt, 1);
      } else { // gate: an island in the middle, then a centred gap
        const a = rand(0.26, 0.38), b = rand(0.62, 0.74);
        queue.push({ dt: p.spawnDt, gaps: [{ l: -1, r: a }, { l: b, r: 2 }] });
        lastC = lastC < 0.5 ? clamp(Math.min(lastC, a - 0.07), EDGE_C, 0.4) : clamp(Math.max(lastC, b + 0.07), 0.6, 1 - EDGE_C);
        pushSingle(p, p.spawnDt * 0.9, 0.9);
      }
      // breathing room after a sequence
      queue[queue.length - 1].dt *= 1.3;
    }

    function spawn(spec) {
      bars.push({
        y: -20,
        gaps: spec.gaps,
        drift: spec.drift,
        born: clock,
        passed: false,
        flash: 0,
        graze: 0
      });
    }

    function barOffset(b) {
      return b.drift ? b.drift.amp * Math.sin(b.drift.phase + (clock - b.born) * b.drift.freq * TAU) : 0;
    }
    function barGapsPx(b) {
      const o = barOffset(b);
      return b.gaps.map(q => ({ l: (q.l + o) * W, r: (q.r + o) * W }));
    }
    function barThickness() { return Math.max(9, Math.round(U * 0.03)); }

    function burst(x, y, n, colors, speed, vyBase) {
      for (let i = 0; i < n; i++) {
        const a = rand(0, TAU), s = rand(0.25, 1) * speed;
        parts.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s + (vyBase || 0),
          vyBase: vyBase || 0, life: 0, max: rand(0.35, 0.9), c: colors[i % colors.length], len: rand(4, 11)
        });
      }
      if (parts.length > 260) parts.splice(0, parts.length - 260);
    }

    // ---------- run lifecycle ----------
    function resetRun() {
      bars = []; queue = []; rings = []; parts = [];
      altitude = 0; runTime = 0; spawnIn = 0.55; lastC = 0.5;
      line.x = W * 0.5; line.dir = 1; line.vx = cfg.turn * U;
      trail = [];
      score.reset();
      newBest = false;
      resetTier();
    }

    function startRun(fromAttract) {
      run += 1;
      if (!fromAttract) resetRun();
      else { bars = []; queue = []; runTime = 0; spawnIn = 0.55; lastC = clamp(line.x / W, 0.2, 0.8); score.reset(); newBest = false; resetTier(); }
      runStartAlt = altitude;
      mode = "play";
      hintAlpha = fromAttract ? 1 : 0;
      try { ctx.platform.start({ attempt: run }); } catch (e) {}
      startMusic();
    }

    async function startMusic() {
      if (music) {
        try { music.setVolume(cfg.musicVol, { fadeMs: 400 }); } catch (e) {}
        return;
      }
      if (!(ctx.capabilities && ctx.capabilities.backgroundMusic)) return;
      try {
        await ctx.music.unlock();
        if (disposed || music) return;
        music = ctx.music.play({ preset: "drift", volume: cfg.musicVol, intensity: 0.25, fadeInMs: 1200 });
      } catch (e) { music = null; }
    }

    function die(hitX, bar) {
      mode = "over";
      deadAt = clock;
      hintAlpha = 0;
      overT = 0;
      shake = 1;
      if (bar) bar.flash = 1;
      burst(hitX, tipY, 34, ["#ffffff", cfg.lineColor, cfg.barColor], U * 0.9, 0);
      haptic("heavy");
      const final = Math.floor(score.value);
      if (final > best) { best = final; newBest = true; }
      if (ctx.capabilities && ctx.capabilities.storage) {
        try { Promise.resolve(ctx.storage.set("best", best)).catch(() => {}); } catch (e) {}
      }
      try { ctx.platform.fail({ score: final, distance: final }); } catch (e) {}
      if (final > 0) {
        try { score.submit("distance", { label: final + " m" }).catch(() => {}); } catch (e) {}
      }
      if (music) {
        try { music.duck(0.6, 900); } catch (e) {}
        try { ctx.music.sting("lose"); } catch (e) {}
      }
    }

    // ---------- tip colour tiers ----------
    function tierRgb(i) {
      const c = TIP_COLORS[i % TIP_COLORS.length];
      return hexToRgb(c || cfg.lineColor);
    }
    function tipRgb() {
      const to = tierRgb(tipTier);
      if (!tipFrom || tipBlend >= 1) return to;
      const e = tipBlend * tipBlend * (3 - 2 * tipBlend);
      return [0, 1, 2].map(i => Math.round(lerp(tipFrom[i], to[i], e)));
    }
    function resetTier() { tipTier = 0; tipBlend = 1; tipFrom = null; }
    function tierUp(tier) {
      tipFrom = tipRgb();
      tipTier = tier;
      tipBlend = 0;
      const c = tierRgb(tier);
      const css = "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")";
      rings.push({ x: line.x, alt: altitude, t: clock, big: true, rgb: c });
      burst(line.x, tipY, 26, [css, "#ffffff", css], U * 0.55, cfg.climb * U * 0.5);
      headPulse = 1;
      haptic("success");
      try { ctx.platform.milestone("distance_" + tier * TIER_STEP, { distance: tier * TIER_STEP }); } catch (e) {}
      if (music) try { ctx.music.sting("powerup"); } catch (e) {}
    }

    // ---------- input ----------
    function flip() {
      line.dir = -line.dir;
      line.turnFrom = line.vx;
      line.turnT = 0;
      headPulse = 1;
      rings.push({ x: line.x, alt: altitude, t: clock });
      if (rings.length > 24) rings.shift();
      if (trail.length) trail[trail.length - 1].turn = true;
    }

    function press() {
      if (disposed) return;
      if (mode === "attract") {
        startRun(true);
        flip();
        haptic("light");
        try { ctx.platform.interact({ type: "turn" }); } catch (e) {}
        return;
      }
      if (mode === "over") {
        if (overT < 0.35) return;
        startRun(false);
        haptic("light");
        try { ctx.platform.interact({ type: "replay" }); } catch (e) {}
        return;
      }
      flip();
      haptic("light");
    }

    ctx.listen(canvas, "pointerdown", e => {
      if (e.cancelable) e.preventDefault();
      if (e.button != null && e.button > 0) return;
      press();
    }, { passive: false });
    ctx.listen(window, "keydown", e => {
      if (e.repeat) return;
      if (e.code === "Space" || e.code === "Enter" || e.code === "ArrowLeft" || e.code === "ArrowRight") {
        if (e.cancelable) e.preventDefault();
        press();
      }
    });

    // ---------- simulation ----------
    function stepLine(dt) {
      // each reversal eases the sideways velocity along a smoothstep, so the
      // line sweeps through a round arc instead of a sharp corner
      const target = line.dir * cfg.turn * U;
      const dur = Math.max(0.001, cfg.smoothMs / 1000);
      if (line.turnT >= 0) {
        line.turnT += dt;
        const s = clamp(line.turnT / dur, 0, 1);
        line.vx = lerp(line.turnFrom, target, s * s * (3 - 2 * s));
        if (s >= 1) line.turnT = -1;
      } else line.vx = target;
      line.x += line.vx * dt;
      // the side edges are lethal in play; outside play the line just bounces
      if (mode !== "play") {
        if (line.x < WALL) { line.x = 2 * WALL - line.x; line.vx = Math.abs(line.vx); line.dir = 1; wallKick(); }
        if (line.x > W - WALL) { line.x = 2 * (W - WALL) - line.x; line.vx = -Math.abs(line.vx); line.dir = -1; wallKick(); }
      }
      altitude += cfg.climb * U * dt;
      trail.push({ x: line.x, alt: altitude, t: clock, turn: false });
      // drop points that have scrolled off the bottom
      const cut = altitude - (H - tipY + 40);
      let i = 0;
      while (i < trail.length - 2 && trail[i].alt < cut) i++;
      if (i > 0) trail.splice(0, i);
      if (trail.length > 900) trail.splice(0, trail.length - 900);
    }
    function wallKick() {
      // settle smoothly to full speed after a mid-turn bounce
      line.turnFrom = line.vx;
      line.turnT = 0;
      if (trail.length) trail[trail.length - 1].turn = true;
    }

    function fixedUpdate(stepMs) {
      if (mode === "over") return;
      const dt = stepMs / 1000;
      clock += dt;
      emberIn -= dt;
      if (emberIn <= 0) {
        emberIn = rand(0.035, 0.08);
        const c = tipRgb(), fall = cfg.climb * U * rand(0.55, 0.9);
        parts.push({
          x: line.x + rand(-1.5, 1.5), y: tipY, vx: rand(-22, 22) - line.vx * 0.12, vy: fall, vyBase: fall,
          life: 0, max: rand(0.35, 0.75), c: "rgb(" + c[0] + "," + c[1] + "," + c[2] + ")", len: 0, dot: rand(0.9, 1.8)
        });
        if (parts.length > 260) parts.shift();
      }

      if (mode === "attract") {
        autoFlipIn -= dt;
        // the demo line keeps to the middle so the first tap never aims it at an edge
        const edgeTurn = (line.dir < 0 && line.x < W * 0.3) || (line.dir > 0 && line.x > W * 0.7);
        if (autoFlipIn <= 0 || edgeTurn) { line.dir = -line.dir; line.turnFrom = line.vx; line.turnT = 0; autoFlipIn = rand(0.35, 1.25); if (trail.length) trail[trail.length - 1].turn = true; }
        stepLine(dt);
        return;
      }

      runTime += dt;
      const d = difficulty(runTime);
      const p = params(d);
      vc = cfg.climb * U + p.vBar;

      spawnIn -= dt;
      if (spawnIn <= 0) {
        if (!queue.length) refill(d);
        const spec = queue.shift();
        spawn(spec);
        spawnIn += spec.dt;
      }

      stepLine(dt);
      if (line.x <= EDGE_HIT || line.x >= W - EDGE_HIT) {
        line.x = clamp(line.x, EDGE_HIT, W - EDGE_HIT);
        die(line.x, null);
        return;
      }
      score.set(Math.floor((altitude - runStartAlt) / unit));
      curD = d;
      const tier = Math.floor(score.value / TIER_STEP);
      if (tier !== tipTier) tierUp(tier);

      const T = barThickness();
      const half = T / 2;
      for (let i = bars.length - 1; i >= 0; i--) {
        const b = bars[i];
        const prevY = b.y;
        b.y += vc * dt;
        if (b.y > H + 60) { bars.splice(i, 1); continue; }
        if (Math.abs(b.y - tipY) <= half) {
          const gaps = barGapsPx(b);
          let safeHere = false;
          for (const q of gaps) {
            if (line.x >= q.l - cfg.margin && line.x <= q.r + cfg.margin) { safeHere = true; break; }
          }
          if (!safeHere) { die(line.x, b); return; }
        }
        if (!b.passed && prevY < tipY && b.y >= tipY) {
          b.passed = true;
          const gaps = barGapsPx(b);
          for (const q of gaps) {
            if (line.x >= q.l - cfg.margin && line.x <= q.r + cfg.margin) {
              const dl = line.x - Math.max(q.l, 0), dr = Math.min(q.r, W) - line.x;
              const edgeD = Math.min(q.l > 0 ? dl : 1e9, q.r < W ? dr : 1e9);
              if (edgeD < 11) {
                const ex = dl < dr ? q.l : q.r;
                b.graze = 1;
                burst(ex, tipY, 10, ["#ffffff", cfg.lineColor], U * 0.45, vc);
                haptic("light");
                try { ctx.platform.interact({ type: "graze" }); } catch (e) {}
              }
              break;
            }
          }
        }
      }

      // let the music bed breathe with the tension
      const inten = clamp(0.22 + d * 0.55, 0, 1);
      if (music && Math.abs(inten - lastIntensity) > 0.08) {
        lastIntensity = inten;
        try { music.setIntensity(inten); } catch (e) {}
      }
    }

    function update(dtMs) {
      const dt = Math.min(0.05, dtMs / 1000);
      headPulse = Math.max(0, headPulse - dt * 4.5);
      if (tipBlend < 1) tipBlend = Math.min(1, tipBlend + dt / 0.7);
      shake = Math.max(0, shake - dt * 3.2);
      if (mode === "over") overT += dt;
      if (mode === "play" && runTime > 1.2) hintAlpha = Math.max(0, hintAlpha - dt * 1.4);
      for (const b of bars) {
        b.flash = Math.max(0, b.flash - dt * (mode === "over" ? 0.9 : 3));
        b.graze = Math.max(0, b.graze - dt * 3);
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const q = parts[i];
        q.life += dt;
        if (q.life >= q.max) { parts.splice(i, 1); continue; }
        const f = Math.exp(-dt * 3.5);
        q.vx *= f; q.vy = (q.vy - q.vyBase) * f + q.vyBase;
        q.x += q.vx * dt; q.y += q.vy * dt;
      }
    }

    // ---------- rendering ----------
    function hexToRgb(hex) {
      const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex).trim());
      if (!m) return [143, 246, 255];
      let h = m[1];
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      const n = parseInt(h, 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    function rgba(rgb, a) { return "rgba(" + rgb[0] + "," + rgb[1] + "," + rgb[2] + "," + a.toFixed(3) + ")"; }
    // gentle hue drift of the line colour as you climb
    function lineRgb() {
      const base = hexToRgb(cfg.lineColor);
      const t = Math.sin(altitude / (U * 9)) * 0.5 + 0.5;
      const tint = [190, 160, 255];
      return [
        Math.round(lerp(base[0], tint[0], t * 0.35)),
        Math.round(lerp(base[1], tint[1], t * 0.35)),
        Math.round(lerp(base[2], tint[2], t * 0.35))
      ];
    }

    function drawDust() {
      g.fillStyle = "rgba(170,190,255,0.22)";
      for (const p of dust) {
        const y = ((p.y * H + altitude * p.z) % (H + 4) + H + 4) % (H + 4) - 2;
        g.globalAlpha = 0.25 + p.z;
        g.fillRect(p.x * W, y, p.r, p.r * (1 + p.z * 5));
      }
      g.globalAlpha = 1;
    }

    function drawBestLine() {
      if (best <= 0 || mode === "attract" || (mode === "over" && newBest)) return;
      const bestAlt = runStartAlt + best * unit;
      const y = tipY + (altitude - bestAlt);
      if (y < -4 || y > H + 4) return;
      g.save();
      g.strokeStyle = "rgba(255,255,255,0.16)";
      g.lineWidth = 1;
      g.setLineDash([3, 7]);
      g.beginPath(); g.moveTo(0, Math.round(y) + 0.5); g.lineTo(W, Math.round(y) + 0.5); g.stroke();
      g.setLineDash([]);
      g.fillStyle = "rgba(255,255,255,0.3)";
      g.font = "600 9px " + FONT;
      g.textAlign = "right";
      g.textBaseline = "bottom";
      g.fillText("BEST", W - 10, y - 4);
      g.restore();
    }

    // side edges: faint danger rails that flare as the tip drifts toward them
    function drawEdges() {
      const rgb = hexToRgb(cfg.barColor);
      const reach = Math.max(40, W * 0.18);
      for (const side of [0, 1]) {
        const d = side ? W - line.x : line.x;
        const near = clamp(1 - d / reach, 0, 1);
        const ex = side ? W : 0;
        const glowW = 10 + near * 26;
        const grad = g.createLinearGradient(ex, 0, side ? W - glowW : glowW, 0);
        grad.addColorStop(0, rgba(rgb, 0.1 + near * 0.35));
        grad.addColorStop(1, rgba(rgb, 0));
        g.fillStyle = grad;
        g.fillRect(side ? W - glowW : 0, 0, glowW, H);
        g.fillStyle = rgba(rgb, 0.35 + near * 0.55);
        g.fillRect(side ? W - 1.5 : 0, 0, 1.5, H);
      }
    }

    function drawBars() {
      const T = barThickness();
      const rgb = hexToRgb(cfg.barColor);
      for (const b of bars) {
        const gaps = barGapsPx(b);
        // solids = complement of gaps within [0, W]
        const solids = [];
        let x = 0;
        const sorted = gaps.slice().sort((a, c) => a.l - c.l);
        for (const q of sorted) {
          if (q.l > x) solids.push([x, Math.min(q.l, W)]);
          x = Math.max(x, q.r);
        }
        if (x < W) solids.push([x, W]);

        let a = 1;
        if (b.y > tipY + T) a = Math.max(0.1, 1 - (b.y - tipY - T) / (H * 0.22));
        a *= clamp((b.y + 20) / 50, 0, 1);
        const y0 = b.y - T / 2;
        const fl = b.flash;

        for (const [sx, ex] of solids) {
          if (ex - sx < 0.5) continue;
          // soft outer glow
          g.fillStyle = rgba(rgb, 0.07 * a + fl * 0.22);
          roundBar(sx - 4, y0 - 4, ex - sx + 8, T + 8, sx > 0.5, ex < W - 0.5);
          g.fill();
          // core
          g.fillStyle = fl > 0.02 ? mixCss(rgb, [255, 255, 255], fl, a) : rgba(rgb, 0.92 * a);
          roundBar(sx, y0, ex - sx, T, sx > 0.5, ex < W - 0.5);
          g.fill();
          // bright lips on the gap edges: this is where survival is decided
          g.fillStyle = "rgba(255,235,240," + (0.55 * a + b.graze * 0.45).toFixed(3) + ")";
          if (sx > 0.5) g.fillRect(sx, y0 + 2, 1.5, T - 4);
          if (ex < W - 0.5) g.fillRect(ex - 1.5, y0 + 2, 1.5, T - 4);
        }
      }
    }
    function mixCss(rgb, to, t, a) {
      return "rgba(" + Math.round(lerp(rgb[0], to[0], t)) + "," + Math.round(lerp(rgb[1], to[1], t)) + "," +
        Math.round(lerp(rgb[2], to[2], t)) + "," + Math.max(a, t).toFixed(3) + ")";
    }
    function roundBar(x, y, w, h, roundL, roundR) {
      const r = Math.min(h / 2, w / 2);
      g.beginPath();
      if (roundL) { g.moveTo(x + r, y); } else g.moveTo(x, y);
      if (roundR) { g.lineTo(x + w - r, y); g.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); }
      else { g.lineTo(x + w, y); g.lineTo(x + w, y + h); }
      if (roundL) { g.lineTo(x + r, y + h); g.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); }
      else { g.lineTo(x, y + h); }
      g.closePath();
    }

    // trail point in screen space, with a slow living sway that grows with age
    function tpx(p) {
      const age = Math.max(0, clock - p.t);
      const sway = Math.sin(age * 2.3 + p.alt * 0.011) * Math.min(age, 1.6) * 2.4;
      return p.x + sway;
    }

    function drawTrail(rgb) {
      const n = trail.length;
      if (n < 2) return;
      const span = H - tipY + 30;
      const BANDS = 14;
      g.save();
      g.globalCompositeOperation = "lighter";
      g.lineJoin = "round";
      g.lineCap = "round";
      const passes = [
        [15, 0.07], [7.5, 0.17], [3.4 + headPulse * 1.8, 0.95]
      ];
      // walk from head to tail in bands of screen distance
      let idx = n - 1;
      for (let band = 0; band < BANDS && idx > 0; band++) {
        const limit = ((band + 1) / BANDS) * span;
        const start = idx;
        while (idx > 0 && altitude - trail[idx - 1].alt <= limit) idx--;
        if (idx > 0 && idx === start) idx--;
        const fade = Math.pow(1 - band / BANDS, 1.35);
        for (const [w, a] of passes) {
          g.strokeStyle = rgba(rgb, a * fade);
          g.lineWidth = band === 0 ? w : Math.max(1.4, w * (1 - band / (BANDS * 1.6)));
          g.beginPath();
          for (let j = start; j >= Math.max(0, idx - 1); j--) {
            const p = trail[j];
            const x = j === n - 1 ? p.x : tpx(p);
            const y = tipY + (altitude - p.alt);
            if (j === start) g.moveTo(x, y); else g.lineTo(x, y);
          }
          g.stroke();
        }
      }
      // turn nodes: tiny beads marking the rhythm of your taps
      for (let j = n - 2; j >= 0; j--) {
        const p = trail[j];
        if (!p.turn) continue;
        const y = tipY + (altitude - p.alt);
        if (y > H + 4) break;
        const a = Math.max(0, 1 - (y - tipY) / span);
        g.fillStyle = rgba([255, 255, 255], 0.55 * a);
        g.beginPath(); g.arc(tpx(p), y, 2, 0, TAU); g.fill();
      }
      g.restore();
    }

    // lub-dub heartbeat that quickens as the climb gets harder
    function heartbeat() {
      const period = lerp(1.15, 0.6, clamp(curD, 0, 1));
      const ph = (clock % period) / period;
      const bump = (c, w) => Math.exp(-((ph - c) / w) * ((ph - c) / w));
      return bump(0.06, 0.05) + 0.6 * bump(0.24, 0.06);
    }

    function drawTip() {
      const x = line.x, y = tipY;
      const rgb = tipRgb();
      const hb = heartbeat();
      const flicker = Math.sin(clock * 23) * 0.6 + Math.sin(clock * 37 + 1.3) * 0.4;
      g.save();
      g.globalCompositeOperation = "lighter";
      // wide breathing aura
      const r = 24 + hb * 12 + headPulse * 12 + flicker;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, rgba(rgb, 0.5 + hb * 0.25));
      grad.addColorStop(0.35, rgba(rgb, 0.18 + hb * 0.12));
      grad.addColorStop(1, rgba(rgb, 0));
      g.fillStyle = grad;
      g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
      // hot inner glow
      g.fillStyle = rgba(rgb, 0.55 + hb * 0.3);
      g.beginPath(); g.arc(x, y, 6 + hb * 2.5 + headPulse * 2, 0, TAU); g.fill();
      // white-hot core
      g.fillStyle = "#ffffff";
      g.beginPath(); g.arc(x, y, 3.4 + hb * 1.1 + headPulse * 1.4, 0, TAU); g.fill();
      // tap rings, anchored to where the turn happened
      for (const ring of rings) {
        const age = clock - ring.t;
        const life = ring.big ? 0.9 : 0.45;
        if (age > life) continue;
        const t = age / life;
        const ry = tipY + (altitude - ring.alt);
        g.strokeStyle = rgba(ring.rgb || rgb, (ring.big ? 0.8 : 0.55) * (1 - t));
        g.lineWidth = ring.big ? 2 : 1.2;
        g.beginPath(); g.arc(ring.x, ry, 4 + t * (ring.big ? 70 : 20), 0, TAU); g.stroke();
      }
      g.restore();
    }

    function drawParts() {
      if (!parts.length) return;
      g.save();
      g.globalCompositeOperation = "lighter";
      g.lineCap = "round";
      for (const q of parts) {
        const t = q.life / q.max;
        const sp = Math.hypot(q.vx, q.vy) || 1;
        const l = q.len * (1 - t * 0.6);
        g.globalAlpha = 1 - t;
        if (q.dot) {
          g.fillStyle = q.c;
          g.beginPath(); g.arc(q.x, q.y, q.dot * (1 - t * 0.7), 0, TAU); g.fill();
          continue;
        }
        g.strokeStyle = q.c;
        g.lineWidth = 1.4;
        g.beginPath();
        g.moveTo(q.x, q.y);
        g.lineTo(q.x - (q.vx / sp) * l, q.y - (q.vy / sp) * l);
        g.stroke();
      }
      g.restore();
    }

    function spacedText(text, x, y, spacing) {
      if ("letterSpacing" in g) {
        g.letterSpacing = spacing + "px";
        g.fillText(text, x + spacing / 2, y);
        g.letterSpacing = "0px";
      } else g.fillText(text, x, y);
    }

    function drawHud() {
      const top = (safe.top || 0) + 30;
      g.textAlign = "center";
      g.textBaseline = "middle";
      if (mode === "play" || (mode === "over" && overT < 0.2)) {
        g.fillStyle = "rgba(235,242,255,0.55)";
        g.font = "500 17px " + FONT;
        g.fillText(String(Math.floor(score.value)), W / 2, top);
      }
      const titleY = Math.max(top + 40, H * 0.3);
      if (mode === "attract" || hintAlpha > 0) {
        const a = mode === "attract" ? 1 : hintAlpha;
        g.fillStyle = "rgba(235,242,255," + (0.85 * a).toFixed(3) + ")";
        g.font = "300 15px " + FONT;
        spacedText("UPSTROKE", W / 2, titleY, 7);
        const pulse = 0.45 + 0.35 * Math.sin(clock * 3.2);
        g.fillStyle = "rgba(235,242,255," + (pulse * a).toFixed(3) + ")";
        g.font = "400 13px " + FONT;
        spacedText(mode === "attract" ? "tap to turn" : "tap  ↔  turn", W / 2, titleY + 30, 2);
      }
      if (mode === "over") {
        const a = clamp(overT / 0.3, 0, 1);
        g.fillStyle = "rgba(5,6,10," + (0.6 * a).toFixed(3) + ")";
        g.fillRect(0, 0, W, H);
        const cy = Math.max(top + 70, H * 0.36);
        g.fillStyle = "rgba(235,242,255," + (0.5 * a).toFixed(3) + ")";
        g.font = "500 11px " + FONT;
        spacedText("DISTANCE", W / 2, cy - 52, 5);
        g.fillStyle = "rgba(255,255,255," + a.toFixed(3) + ")";
        g.font = "200 " + Math.round(Math.min(84, U * 0.2)) + "px " + FONT;
        g.fillText(String(Math.floor(score.value)), W / 2, cy);
        g.font = "500 11px " + FONT;
        if (newBest) {
          g.fillStyle = rgba(hexToRgb(cfg.lineColor), a);
          spacedText("NEW BEST", W / 2, cy + 50, 5);
        } else {
          g.fillStyle = "rgba(235,242,255," + (0.45 * a).toFixed(3) + ")";
          spacedText("BEST  " + best, W / 2, cy + 50, 4);
        }
        if (overT > 0.35) {
          const pulse = 0.55 + 0.4 * Math.sin(overT * 4);
          g.fillStyle = "rgba(255,255,255," + (pulse * clamp((overT - 0.35) / 0.25, 0, 1)).toFixed(3) + ")";
          g.font = "600 13px " + FONT;
          spacedText("TRY AGAIN", W / 2, cy + 118, 6);
        }
      }
    }

    function render() {
      g.fillStyle = BG;
      g.fillRect(0, 0, W, H);
      g.save();
      if (shake > 0) {
        const s = shake * shake * 7;
        g.translate(rand(-s, s), rand(-s, s));
      }
      drawDust();
      drawBestLine();
      const rgb = lineRgb();
      drawTrail(rgb);
      drawBars();
      drawEdges();
      drawTip();
      drawParts();
      g.restore();
      drawHud();
    }

    // seed a short trail so the first frame already shows the line in motion
    for (let i = 0; i < 90; i++) fixedUpdate(1000 / 120);

    ctx.game.loop({ fixedHz: 120, maxSubsteps: 10, maxDeltaMs: 100, update, fixedUpdate, render });
    render();
    ctx.platform.ready();
  }
};
