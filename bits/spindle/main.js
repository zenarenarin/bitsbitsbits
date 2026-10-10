window.plethoraBit = {
  meta: {
    title: "Spindle",
    runtime: "plethora-bit@2",
    tags: ["arcade", "timing", "one-tap"],
    permissions: ["haptics", "audio"]
  },

  async init(ctx) {
    // =====================================================================
    // Palette & constants
    // =====================================================================
    const C = {
      bg: "#080909",
      core: "#171A18",
      metal: "#AEB7AF",
      lime: "#C6FF00",
      white: "#F2F5EB",
      red: "#FF4D57",
      warm: "#EEF55E"           // waiting-pin tip: a touch warmer than lime
    };
    const TAU = Math.PI * 2;
    const DOWN = Math.PI / 2;   // canvas y points down: the launch axis

    // Geometry ratios, all relative to R (distance from centre to a tip's centre).
    const G = {
      core: 0.27,               // core radius
      shaftHalf: 0.0085,        // shaft half-width (visual = collision * forgiveness)
      tip: 0.034,               // tip radius
      stub: 0.13,               // length of the launched dart's stub (bead to head)
      waitGap: 0.6              // gap between sculpture and the waiting dart's head
    };

    const tune = {
      speed: () => ctx.tune.number("rotation_speed") ?? 1,
      launchMs: () => ctx.tune.durationMs("launch_ms") ?? 190,
      forgive: () => ctx.tune.percent("collision_forgiveness") ?? 0.86,
      ramp: () => ctx.tune.number("difficulty_ramp") ?? 1,
      startLevel: () => ctx.tune.integer("start_level") ?? 1,
      volume: () => ctx.tune.percent("sound_volume") ?? 0.6
    };

    // =====================================================================
    // Canvas initialisation
    // =====================================================================
    const canvas = ctx.createCanvas2D({
      maxDpr: 2, coordinateSpace: "css", alpha: false, touchAction: "none", layer: "content"
    });
    const g = canvas.getContext("2d");

    const FONT = '"Space Grotesk", "Inter", system-ui, -apple-system, "Segoe UI", sans-serif';

    // HUD + overlays (DOM, passthrough except for buttons)
    const hud = ctx.createRoot({ layer: "overlay", input: "passthrough" });
    hud.innerHTML =
      "<style>" +
      ".sp{position:absolute;inset:0;font-family:" + FONT.replace(/"/g, "'") + ";color:" + C.white + ";-webkit-font-smoothing:antialiased;user-select:none;-webkit-user-select:none}" +
      ".sp-level{position:absolute;left:0;right:0;text-align:center;font-size:11px;letter-spacing:.32em;font-weight:500;color:rgba(174,183,175,.62);text-transform:uppercase}" +
      ".sp-level b{color:" + C.white + ";font-weight:700;letter-spacing:.14em;margin-left:.35em;font-variant-numeric:tabular-nums}" +
      ".sp-card{position:absolute;left:50%;transform:translate(-50%,6px);opacity:0;transition:opacity .18s ease,transform .22s cubic-bezier(.2,.8,.2,1);text-align:center;pointer-events:none;min-width:220px}" +
      ".sp-card.on{opacity:1;transform:translate(-50%,0)}" +
      ".sp-card.on .sp-btn{pointer-events:auto}" +
      ".sp-kicker{font-size:11px;letter-spacing:.32em;text-transform:uppercase;font-weight:600;margin-bottom:8px}" +
      ".sp-title{font-size:22px;font-weight:600;letter-spacing:.01em;margin-bottom:18px}" +
      ".sp-btn{display:inline-flex;align-items:center;gap:10px;height:44px;padding:0 22px;border-radius:22px;border:1px solid rgba(242,245,235,.18);background:rgba(23,26,24,.88);color:" + C.white + ";font:600 13px/1 " + FONT.replace(/"/g, "'") + ";letter-spacing:.2em;text-transform:uppercase;cursor:pointer;position:relative;overflow:hidden;-webkit-tap-highlight-color:transparent}" +
      ".sp-btn i{display:block;width:7px;height:7px;border-radius:50%}" +
      ".sp-btn .bar{position:absolute;left:0;bottom:0;height:2px;width:0;background:" + C.lime + ";opacity:.8}" +
      ".sp-btn:focus-visible{outline:1px solid " + C.lime + ";outline-offset:3px}" +
      "</style>" +
      '<div class="sp">' +
      '<div class="sp-level" id="lvl">Level<b id="lvlN">1</b></div>' +
      '<div class="sp-card" id="card">' +
      '<div class="sp-kicker" id="kick"></div>' +
      '<div class="sp-title" id="ttl"></div>' +
      '<button class="sp-btn" id="btn" type="button"><i id="dot"></i><span id="btnT"></span><span class="bar" id="bar"></span></button>' +
      "</div></div>";
    const $ = (id) => hud.querySelector("#" + id);
    const el = {
      lvl: $("lvl"), lvlN: $("lvlN"), card: $("card"), kick: $("kick"),
      ttl: $("ttl"), btn: $("btn"), btnT: $("btnT"), dot: $("dot"), bar: $("bar")
    };

    // =====================================================================
    // Responsive layout
    // =====================================================================
    const L = { w: 0, h: 0, cx: 0, cy: 0, R: 100, Rc: 27, tip: 3.4, half: 0.85, stub: 13, d0: 180, len: 73, vignette: null };

    function layout({ width, height, safeArea }) {
      const sa = safeArea || ctx.safeArea || { top: 0, bottom: 0, left: 0, right: 0 };
      L.w = width; L.h = height;
      const top = sa.top + 52;                      // level label sits above this
      const bottom = height - Math.max(sa.bottom, 12) - 18;
      const avail = Math.max(120, bottom - top);
      // Vertical extent in R units: above centre = 1 + tip; below = waiting pin tail.
      const above = 1 + G.tip;
      const below = 1 + G.tip + G.waitGap + G.stub + G.tip;
      const span = above + below;
      const R = Math.max(60, Math.min((width - 36) / (2 * above), avail / span, 300));
      L.R = R;
      L.Rc = R * G.core;
      L.tip = R * G.tip;
      L.half = Math.max(1.1, R * G.shaftHalf);
      L.len = R - L.Rc;
      L.stub = R * G.stub;
      L.d0 = R + L.tip + R * G.waitGap + L.stub;    // waiting dart's bead distance from centre
      const slack = avail - span * R;
      L.cx = width / 2;
      L.cy = top + slack * 0.48 + above * R;
      el.lvl.style.top = (sa.top + 20) + "px";
      const cardTop = L.cy + R + L.tip + Math.max(26, R * 0.16);
      el.card.style.top = Math.min(cardTop, bottom - 110) + "px";
      buildVignette();
      geomCache = null;
    }

    function buildVignette() {
      // Barely-there vignette; the gradient is built once per layout.
      const r = Math.hypot(L.w, L.h) * 0.62;
      const grad = g.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, r);
      grad.addColorStop(0, "rgba(22,26,22,0.55)");
      grad.addColorStop(0.55, "rgba(8,9,9,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.45)");
      L.vignette = grad;
    }

    // =====================================================================
    // Collision model (single geometric model shared with drawing)
    // A pin is a shaft segment [rIn, rIn+len] along an angle with half-width
    // `half`, plus a round tip of radius `tip` centred at the outer end.
    // Attached pins span [Rc, R]. The launched dart is the same shape with a
    // short shaft (`stub`): bead at distance D, head at D - stub. When the bead
    // reaches R, the full shaft snaps into the core and the full pin is tested.
    // Collision radii are the visual radii scaled by `forgive`, so near-misses
    // that look clear are accepted; any real overlap fails.
    // =====================================================================
    function pinPoints(angle, rIn, len = L.len) {
      const c = Math.cos(angle), s = Math.sin(angle);
      return { ax: c * rIn, ay: s * rIn, bx: c * (rIn + len), by: s * (rIn + len) };
    }

    function segPointDist2(ax, ay, bx, by, px, py) {
      const dx = bx - ax, dy = by - ay;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + dx * t - px, qy = ay + dy * t - py;
      return qx * qx + qy * qy;
    }

    function segSegDist2(p, q) {
      // Segments here never properly cross unless they share endpoints region;
      // check proper intersection, else min endpoint-to-segment distance.
      const d1x = p.bx - p.ax, d1y = p.by - p.ay, d2x = q.bx - q.ax, d2y = q.by - q.ay;
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) > 1e-12) {
        const t = ((q.ax - p.ax) * d2y - (q.ay - p.ay) * d2x) / den;
        const u = ((q.ax - p.ax) * d1y - (q.ay - p.ay) * d1x) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
      }
      return Math.min(
        segPointDist2(p.ax, p.ay, p.bx, p.by, q.ax, q.ay),
        segPointDist2(p.ax, p.ay, p.bx, p.by, q.bx, q.by),
        segPointDist2(q.ax, q.ay, q.bx, q.by, p.ax, p.ay),
        segPointDist2(q.ax, q.ay, q.bx, q.by, p.bx, p.by)
      );
    }

    function pinsCollide(p, q, f) {
      const h = L.half * f, t = L.tip * f;
      if (segSegDist2(p, q) < (2 * h) * (2 * h)) return true;
      const tt = (2 * t) * (2 * t);
      const dx = p.bx - q.bx, dy = p.by - q.by;
      if (dx * dx + dy * dy < tt) return true;
      const ts = (t + h) * (t + h);
      if (segPointDist2(q.ax, q.ay, q.bx, q.by, p.bx, p.by) < ts) return true;
      if (segPointDist2(p.ax, p.ay, p.bx, p.by, q.bx, q.by) < ts) return true;
      return false;
    }

    // Minimum safe angular separation between two attached pins (radians),
    // solved from the same capsule model. Scale-invariant, so cache by forgiveness.
    let geomCache = null;
    function minSeparation(f) {
      if (geomCache && geomCache.f === f) return geomCache.sep;
      let lo = 0, hi = 0.6;
      const a = pinPoints(0, L.Rc);
      for (let i = 0; i < 40; i++) {
        const mid = (lo + hi) / 2;
        if (pinsCollide(a, pinPoints(mid, L.Rc), f)) lo = mid; else hi = mid;
      }
      geomCache = { f, sep: hi };
      return hi;
    }

    // =====================================================================
    // Level generation (endless, deterministic per level, fairness-checked)
    // =====================================================================
    function seeded(level) {
      // mulberry32: same level -> same arrangement, every time.
      let s = ((level * 2654435761) ^ 0x9e3779b9) >>> 0;
      const float = () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      return {
        float,
        int: (lo, hi) => lo + Math.floor(float() * (hi - lo + 1)),   // inclusive
        chance: (p) => float() < p
      };
    }

    function rotationProfile(mode, w0, period) {
      // Angular velocity as a smooth function of level time (seconds).
      if (mode === "wave") return (t) => w0 * (1 + 0.38 * Math.sin((TAU * t) / period));
      if (mode === "reverse") {
        const k = 2.4, n = Math.tanh(k);
        return (t) => (w0 * Math.tanh(k * Math.sin((TAU * t) / period + 0.9))) / n;
      }
      return () => w0;
    }

    function gapsOf(angles) {
      const a = angles.map((x) => ((x % TAU) + TAU) % TAU).sort((x, y) => x - y);
      const gaps = [];
      for (let i = 0; i < a.length; i++) gaps.push((i + 1 < a.length ? a[i + 1] : a[0] + TAU) - a[i]);
      return gaps;
    }

    function capacity(angles, sep) {
      if (!angles.length) return Infinity;
      return gapsOf(angles).reduce((n, gp) => n + Math.max(0, Math.floor(gp / sep) - 1), 0);
    }

    function arrange(style, n, rng, sep) {
      const off = rng.float() * TAU;
      const out = [];
      if (style === "even" || n <= 1) {
        for (let i = 0; i < n; i++) out.push(off + (TAU * i) / n);
      } else if (style === "jitter") {
        for (let i = 0; i < n; i++) out.push(off + (TAU * (i + (rng.float() - 0.5) * 0.55)) / n);
      } else if (style === "clusters") {
        const groups = Math.max(2, Math.round(n / (2 + rng.int(0, 1))));
        let placed = 0;
        for (let gi = 0; gi < groups && placed < n; gi++) {
          const size = gi === groups - 1 ? n - placed : Math.max(1, Math.round((n - placed) / (groups - gi)));
          const base = off + (TAU * gi) / groups;
          for (let j = 0; j < size; j++) out.push(base + j * sep * 2.3);
          placed += size;
        }
      } else if (style === "arc") {
        const span = TAU * (0.5 + rng.float() * 0.2);
        for (let i = 0; i < n; i++) out.push(off + (span * i) / Math.max(1, n - 1));
      } else {
        for (let i = 0; i < n; i++) out.push(off + rng.float() * TAU);
      }
      return out.map((x) => ((x % TAU) + TAU) % TAU);
    }

    function generateLevel(level) {
      const rng = seeded(level);
      const p = Math.max(0, level - 1) * Math.max(0.2, tune.ramp());
      const e = 1 - Math.exp(-p / 10);           // fast early ramp, saturating
      const lin = Math.min(1, p / 140);          // slow long-tail ramp
      const f = tune.forgive();
      const sep = minSeparation(f);

      // Rotation: speed and character.
      let mode = "steady";
      if (level >= 7) {
        const r = rng.float();
        if (level >= 12 && r < 0.18) mode = "reverse";
        else if (r < 0.48) mode = "wave";
      }
      const dir = level < 3 ? 1 : rng.chance(0.5) ? 1 : -1;
      let w0 = (0.82 + 1.0 * e + 0.32 * lin) * tune.speed();
      if (mode === "wave") w0 *= 0.86;
      if (mode === "reverse") w0 *= 1.05;
      w0 = Math.min(w0, 2.1 * tune.speed());
      const period = mode === "reverse" ? 5.5 + rng.float() * 2.5 : 3.6 + rng.float() * 2;
      const peak = mode === "wave" ? w0 * 1.38 : w0;

      // Counts.
      let n0 = 3 + Math.round(7 * e + 4 * lin) + (level >= 4 ? rng.int(-1, 1) : 0);
      let k = 5 + Math.round(7 * e + 4 * lin) + (level >= 3 ? rng.int(0, 1) : 0);
      n0 = Math.max(2, Math.min(n0, 16));
      k = Math.max(4, Math.min(k, 18));

      // Fairness: with N-1 pins spread evenly, the last gap must give the
      // player at least `win` seconds of clear timing at peak rotation speed,
      // plus the time the dart's stub spends crossing the ring of tips.
      const win = Math.max(0.075, 0.44 * Math.exp(-p / 9));
      const sweep = ((G.stub + 2 * G.tip) / (G.tip + G.waitGap + G.stub)) * (tune.launchMs() / 1000);
      const maxN = 1 + Math.floor(TAU / (2 * sep + peak * (win + sweep)));
      while (n0 + k > maxN && (n0 > 2 || k > 4)) {
        if (n0 > 2 && (n0 > k * 0.55 || k <= 4)) n0--; else k--;
      }

      // Arrangement: varied styles, min spacing and placement capacity enforced.
      const styles = level <= 3 ? ["even"] : level <= 6 ? ["even", "jitter"] :
        ["even", "jitter", "jitter", "clusters", "arc", "random", "random"];
      let pins = null;
      for (let attempt = 0; attempt < 30 && !pins; attempt++) {
        const style = styles[rng.int(0, styles.length - 1)];
        const cand = arrange(style, n0, rng, sep);
        const gaps = gapsOf(cand);
        const minGap = Math.min(...gaps);
        if (n0 > 1 && minGap < sep * 2.05) continue;
        if (capacity(cand, sep * 1.05) < Math.ceil(k * 1.5)) continue;
        pins = cand;
      }
      if (!pins) pins = arrange("even", n0, rng, sep);

      return { level, pins, launches: k, w0, dir, mode, period, peak, sweep, difficulty: +(e * 0.7 + lin * 0.3).toFixed(3), sep };
    }

    // =====================================================================
    // Game state (rules) — rendering never writes to this
    // =====================================================================
    const S = {
      level: 1,
      cfg: null,
      omega: null,
      rot: 0,            // assembly rotation (rad)
      t: 0,              // level time (s)
      attached: [],      // [{ a: localAngle, born: ms }]
      remaining: 0,
      phase: "boot",     // boot | intro | ready | flying | failed | cleared | outro
      phaseT: 0,         // ms in current phase
      flight: null,      // { d, elapsed }
      hit: null,         // index of pin collided with
      attempt: 0,
      started: false,
      best: 0
    };

    // Visual-only state (animations); safe to discard any time.
    const V = {
      pop: 0, impact: 0, shake: 0, failFlash: 0, clearT: -1, flashes: [],
      introK: 1, outroK: 0, numberPop: 0, time: 0
    };

    function loadLevel(level, { fresh = true } = {}) {
      S.level = level;
      S.cfg = generateLevel(level);
      S.omega = rotationProfile(S.cfg.mode, S.cfg.w0 * S.cfg.dir, S.cfg.period);
      S.t = 0;         // rotation profile restarts; orientation stays continuous
      S.attached = S.cfg.pins.map((a) => ({ a, born: -1 }));
      S.remaining = S.cfg.launches;
      S.flight = null;
      S.hit = null;
      setPhase("intro");
      V.introK = 0; V.clearT = -1; V.failFlash = 0; V.shake = 0; V.flashes.length = 0;
      el.lvlN.textContent = String(level);
      hideCard();
      ctx.platform.setProgress(0, { level, retry: !fresh });
    }

    function setPhase(p) { S.phase = p; S.phaseT = 0; }

    // =====================================================================
    // Rotation update + pin launch + collision (fixed small substeps)
    // =====================================================================
    const SUB_MS = 2;

    function stepRules(ms) {
      S.phaseT += ms;
      const rotating = S.phase === "intro" || S.phase === "ready" || S.phase === "flying" || S.phase === "cleared" || S.phase === "outro";
      let left = rotating ? ms : 0;
      while (left > 0) {
        const dt = Math.min(SUB_MS, left);
        left -= dt;
        const sec = dt / 1000;
        // midpoint integration of the smooth velocity profile
        S.rot += S.omega(S.t + sec / 2) * sec;
        S.t += sec;
        if (S.phase === "flying") stepFlight(dt);
        if (S.phase === "failed") break;
      }
      if (Math.abs(S.rot) > TAU * 64) S.rot %= TAU;
      if (S.phase === "intro" && S.phaseT >= 300) setPhase("ready");
      if (S.phase === "outro" && S.phaseT >= 220) loadLevel(S.level + 1);
    }

    function stepFlight(dt) {
      const fl = S.flight;
      fl.elapsed += dt;
      const T = tune.launchMs();
      const u = Math.min(1, fl.elapsed / T);
      fl.d = L.d0 - (L.d0 - L.R) * u;
      const f = tune.forgive();
      // In flight: the dart (bead + stub). On arrival: the full pin.
      const mine = u < 1 ? pinPoints(DOWN, fl.d - L.stub, L.stub) : pinPoints(DOWN, L.Rc);
      for (let i = 0; i < S.attached.length; i++) {
        const other = pinPoints(S.attached[i].a + S.rot, L.Rc);
        if (pinsCollide(mine, other, f)) { onFail(i); return; }
      }
      if (u >= 1) onAttach();
    }

    function launch() {
      if (S.phase !== "ready" || S.remaining <= 0) return false;
      if (!S.started) {
        S.started = true;
        S.attempt++;
        ctx.platform.start({ level: S.level, attempt: S.attempt });
      }
      setPhase("flying");
      S.flight = { d: L.d0, elapsed: 0 };
      ctx.platform.interact({ type: "launch", level: S.level, remaining: S.remaining });
      sound.launch();
      return true;
    }

    // =====================================================================
    // Successful placement
    // =====================================================================
    function onAttach() {
      const local = ((DOWN - S.rot) % TAU + TAU) % TAU;
      S.attached.push({ a: local, born: V.time });
      S.remaining = Math.max(0, S.remaining - 1);
      S.flight = null;
      V.impact = 1; V.numberPop = 1;
      V.flashes.push({ a: local, t: 0 });
      haptic("light");
      sound.attach(S.cfg.launches - S.remaining);
      ctx.platform.setProgress(1 - S.remaining / S.cfg.launches, { level: S.level });
      if (S.remaining === 0) onClear(); else setPhase("ready");
    }

    // =====================================================================
    // Level completion
    // =====================================================================
    function onClear() {
      setPhase("cleared");
      V.clearT = 0;
      haptic("success");
      sound.clear();
      const cleared = S.level;
      ctx.platform.milestone("level_clear", { level: cleared, difficulty: S.cfg.difficulty });
      if (cleared > S.best) {
        S.best = cleared;
        score.set(cleared, { reason: "level_clear" });
        score.checkpoint("best_level", { label: "Level " + cleared }).catch(() => {});
      }
      saveProgress(cleared + 1);
      if (cleared % 10 === 0) {
        ctx.timeout(() => {
          try { ctx.pulse.complete({ level: cleared, text: "Cleared level " + cleared + " in Spindle" }); } catch (e) {}
        }, 700);
      }
      ctx.timeout(() => {
        if (S.phase !== "cleared") return;
        showCard({
          kicker: "Level " + cleared, kickColor: C.lime, title: "Cleared",
          label: "Next level", dot: C.lime, auto: 1900
        });
      }, 560);
    }

    function nextLevel() {
      if (S.phase !== "cleared" || S.phaseT < 560) return;
      ctx.platform.interact({ type: "next", level: S.level + 1 });
      hideCard();
      setPhase("outro");
      V.outroK = 0;
    }

    // =====================================================================
    // Failure and retry
    // =====================================================================
    function onFail(hitIndex) {
      setPhase("failed");
      S.hit = hitIndex;
      V.shake = 1; V.failFlash = 1;
      haptic("error");
      sound.fail();
      ctx.platform.fail({ level: S.level, remaining: S.remaining });
      S.started = false;
      ctx.timeout(() => {
        if (S.phase !== "failed") return;
        showCard({
          kicker: "Pins touched", kickColor: C.red, title: "Level " + S.level,
          label: "Retry", dot: C.red, auto: 0
        });
      }, 380);
    }

    function retry() {
      if (S.phase !== "failed" || S.phaseT < 380) return;
      ctx.platform.interact({ type: "retry", level: S.level });
      loadLevel(S.level, { fresh: false });
    }

    // =====================================================================
    // Overlay card
    // =====================================================================
    let cardToken = 0;
    function showCard({ kicker, kickColor, title, label, dot, auto }) {
      el.kick.textContent = kicker; el.kick.style.color = kickColor;
      el.ttl.textContent = title;
      el.btnT.textContent = label;
      el.dot.style.background = dot;
      el.bar.style.transition = "none"; el.bar.style.width = "0";
      el.card.classList.add("on");
      cardToken++;
      if (auto) {
        // Visible countdown so auto-advance never surprises the player.
        void el.bar.offsetWidth;   // commit the reset before animating
        el.bar.style.transition = "width " + auto + "ms linear";
        el.bar.style.width = "100%";
        const token = cardToken;
        ctx.timeout(() => { if (token === cardToken) nextLevel(); }, auto);
      }
    }
    function hideCard() {
      el.card.classList.remove("on");
      cardToken++;
    }

    // =====================================================================
    // Input handling (touch, mouse, Space/Enter)
    // =====================================================================
    function primaryAction() {
      audioUnlock();
      if (S.phase === "ready") launch();
      else if (S.phase === "failed") retry();
      else if (S.phase === "cleared") nextLevel();
    }

    ctx.listen(canvas, "pointerdown", (e) => {
      if (e.button !== undefined && e.button > 0) return;
      if (e.cancelable) e.preventDefault();
      primaryAction();
    });
    ctx.input.activate(el.btn, () => primaryAction());
    ctx.listen(window, "keydown", (e) => {
      if (e.code !== "Space" && e.key !== " " && e.key !== "Enter") return;
      if (e.cancelable) e.preventDefault();
      if (e.repeat) return;
      primaryAction();
    });

    // =====================================================================
    // Platform: haptics, score record, resumable progress, sound
    // =====================================================================
    const score = ctx.game.score({ initial: 0, min: 0 });

    function haptic(kind) {
      if (ctx.capabilities.haptics) { try { ctx.platform.haptic(kind); } catch (e) {} }
    }

    function saveProgress(level) {
      try {
        ctx.game.progress.save("main", {
          state: { level, best: S.best }, label: "Level " + level, stateSchemaVersion: 1
        }).catch(() => {});
      } catch (e) {}
    }

    async function loadProgress() {
      try {
        const saved = await Promise.race([
          ctx.game.progress.load("main"),
          new Promise((r) => ctx.timeout(() => r(null), 900))
        ]);
        if (saved && saved.resumeEligible === true && saved.state && Number.isInteger(saved.state.level) && saved.state.level >= 1) {
          S.best = Math.max(0, saved.state.best | 0);
          if (S.best > 0) score.set(S.best, { reason: "resume" });
          return Math.min(saved.state.level, 9999);
        }
      } catch (e) {}
      return null;
    }

    // Tiny synthesised metallic sounds — no assets, gated on the audio permission.
    let ac = null, master = null;
    function audioUnlock() {
      if (!ctx.capabilities.audio) return;
      try {
        if (!ac) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          ac = new AC();
          master = ac.createGain();
          master.gain.value = tune.volume();
          master.connect(ac.destination);
        }
        if (ac.state === "suspended") ac.resume();
      } catch (e) { ac = null; }
    }
    ctx.onDestroy(() => { try { ac && ac.close(); } catch (e) {} ac = null; });

    function tone(freq, { type = "sine", attack = 0.002, decay = 0.12, gain = 0.2, at = 0, glide = 0 } = {}) {
      if (!ac || ac.state !== "running") return;
      const t0 = ac.currentTime + at;
      const o = ac.createOscillator(), v = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (glide) o.frequency.exponentialRampToValueAtTime(freq * glide, t0 + decay);
      v.gain.setValueAtTime(0.0001, t0);
      v.gain.exponentialRampToValueAtTime(gain, t0 + attack);
      v.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
      o.connect(v); v.connect(master);
      o.start(t0); o.stop(t0 + decay + 0.02);
    }
    const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const sound = {
      launch() { tone(520, { type: "triangle", decay: 0.05, gain: 0.035, glide: 1.6 }); },
      attach(n) {
        const f = 1046 * Math.pow(2, SCALE[(n - 1) % SCALE.length] / 12);
        tone(f, { decay: 0.16, gain: 0.12 });
        tone(f * 2.76, { decay: 0.06, gain: 0.03 });
      },
      fail() {
        tone(150, { type: "triangle", decay: 0.32, gain: 0.22, glide: 0.6 });
        tone(158, { type: "sine", decay: 0.28, gain: 0.12, glide: 0.62 });
      },
      clear() {
        tone(1318, { decay: 0.5, gain: 0.09 });
        tone(1760, { decay: 0.6, gain: 0.08, at: 0.09 });
        tone(2637, { decay: 0.5, gain: 0.03, at: 0.18 });
      }
    };
    ctx.tune.onChange && ctx.tune.onChange("sound_volume", () => { if (master) master.gain.value = tune.volume(); });

    // =====================================================================
    // Rendering
    // =====================================================================
    const easeOut = (x) => 1 - Math.pow(1 - x, 3);
    const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
    // Fixed key light from the upper left; pins catch it as they turn.
    const LIGHT = { x: -0.62, y: -0.78 };

    function drawBackground() {
      g.fillStyle = C.bg; g.fillRect(0, 0, L.w, L.h);
      if (L.vignette) { g.fillStyle = L.vignette; g.fillRect(0, 0, L.w, L.h); }
    }

    // A single pin drawn along `angle` with inner end at rIn (assembly-centred coords).
    function drawPin(angle, rIn, opts) {
      const { tipColor = C.lime, grow = 1, glow = 0, tint = null, waiting = false, len: fullLen = L.len } = opts || {};
      const c = Math.cos(angle), s = Math.sin(angle);
      const len = fullLen * grow;
      const rOut = rIn + len;
      const tipR = L.tip * (0.35 + 0.65 * grow);
      const w = L.half * 2;
      const shaftEnd = rOut - tipR * 0.5;

      // Shaft: occluded near the core, brightening outward.
      const ax = c * rIn, ay = s * rIn, bx = c * shaftEnd, by = s * shaftEnd;
      const grad = g.createLinearGradient(ax, ay, bx, by);
      if (tint) {
        grad.addColorStop(0, "#5a2a2d"); grad.addColorStop(1, tint);
      } else if (waiting) {
        grad.addColorStop(0, "#c9d1c9"); grad.addColorStop(1, "#7d867f");
      } else {
        grad.addColorStop(0, "#3c423e"); grad.addColorStop(0.22, "#7c857e"); grad.addColorStop(1, C.metal);
      }
      g.lineCap = "round";
      g.strokeStyle = grad;
      g.lineWidth = w;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();

      // Specular line on the lit side; intensity follows the fixed key light.
      const nx = -s, ny = c;
      const facing = nx * LIGHT.x + ny * LIGHT.y;
      const side = facing >= 0 ? 1 : -1;
      const lit = 0.18 + 0.5 * Math.abs(facing);
      g.strokeStyle = "rgba(242,245,235," + lit.toFixed(3) + ")";
      g.lineWidth = Math.max(0.6, w * 0.32);
      const o = w * 0.22 * side;
      const skip = Math.min(L.R * 0.06, len * 0.25);
      g.beginPath();
      g.moveTo(ax + c * skip + nx * o, ay + s * skip + ny * o);
      g.lineTo(bx + nx * o, by + ny * o);
      g.stroke();

      // Tip: soft halo, solid bead, darker rim, fixed specular glint.
      const tx = c * rOut, ty = s * rOut;
      const haloA = 0.14 + glow * 0.5;
      const halo = g.createRadialGradient(tx, ty, tipR * 0.6, tx, ty, tipR * (2.6 + glow * 1.6));
      halo.addColorStop(0, hexA(tipColor, haloA));
      halo.addColorStop(1, hexA(tipColor, 0));
      g.fillStyle = halo;
      g.beginPath(); g.arc(tx, ty, tipR * (2.6 + glow * 1.6), 0, TAU); g.fill();

      g.fillStyle = tipColor;
      g.beginPath(); g.arc(tx, ty, tipR, 0, TAU); g.fill();
      g.strokeStyle = "rgba(0,0,0,0.28)";
      g.lineWidth = Math.max(0.6, tipR * 0.18);
      g.beginPath(); g.arc(tx, ty, tipR - g.lineWidth / 2, 0, TAU); g.stroke();
      g.fillStyle = "rgba(255,255,255,0.75)";
      g.beginPath(); g.arc(tx + LIGHT.x * tipR * 0.38, ty + LIGHT.y * tipR * 0.38, tipR * 0.26, 0, TAU); g.fill();
    }

    function drawSocket(angle) {
      // Small collar where the shaft meets the core rim.
      g.save();
      g.rotate(angle);
      g.fillStyle = "#2a302c";
      const w = L.half * 2 + Math.max(1.6, L.R * 0.012);
      const h = Math.max(3, L.R * 0.03);
      g.fillRect(L.Rc - h * 0.35, -w / 2, h, w);
      g.fillStyle = "rgba(198,255,0,0.55)";
      g.fillRect(L.Rc - h * 0.35, -w / 2, Math.max(0.8, h * 0.22), w);
      g.restore();
    }

    function drawCore(fail, clearK) {
      const Rc = L.Rc;
      // Soft contact shadow / ambient occlusion beneath the core.
      const sh = g.createRadialGradient(0, Rc * 0.18, Rc * 0.7, 0, Rc * 0.18, Rc * 1.45);
      sh.addColorStop(0, "rgba(0,0,0,0.55)");
      sh.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sh;
      g.beginPath(); g.arc(0, Rc * 0.18, Rc * 1.45, 0, TAU); g.fill();

      // Graphite body: light from upper left, fixed in screen space.
      const body = g.createRadialGradient(-Rc * 0.38, -Rc * 0.46, Rc * 0.1, 0, 0, Rc);
      body.addColorStop(0, "#2c312d");
      body.addColorStop(0.55, C.core);
      body.addColorStop(1, "#0d0f0e");
      g.fillStyle = body;
      g.beginPath(); g.arc(0, 0, Rc, 0, TAU); g.fill();

      // Engraved inner ring with micro-ticks (rotates with the assembly).
      g.save();
      g.rotate(S.rot);
      g.strokeStyle = "rgba(242,245,235,0.07)";
      g.lineWidth = 1;
      g.beginPath(); g.arc(0, 0, Rc * 0.8, 0, TAU); g.stroke();
      g.strokeStyle = "rgba(242,245,235,0.12)";
      g.beginPath();
      for (let i = 0; i < 36; i++) {
        const a = (TAU * i) / 36;
        const r0 = Rc * (i % 3 === 0 ? 0.73 : 0.76);
        g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        g.lineTo(Math.cos(a) * Rc * 0.8, Math.sin(a) * Rc * 0.8);
      }
      g.stroke();
      g.restore();

      // Narrow rim highlight (fixed upper-left).
      g.strokeStyle = "rgba(242,245,235,0.28)";
      g.lineWidth = Math.max(1, Rc * 0.035);
      g.beginPath(); g.arc(0, 0, Rc * 0.9, Math.PI * 1.08, Math.PI * 1.42); g.stroke();

      // Fine outline.
      const ow = Math.max(1.4, Rc * 0.05);
      g.strokeStyle = S.phase === "failed" ? C.red : C.lime;
      g.lineWidth = ow * (1 + V.impact * 0.5);
      g.beginPath(); g.arc(0, 0, Rc - ow / 2, 0, TAU); g.stroke();

      // Level-clear: a highlight travels once around the rim.
      if (clearK >= 0 && clearK < 1) {
        const head = -Math.PI / 2 + easeOut(clearK) * TAU;
        const fade = Math.sin(Math.PI * clearK);
        g.lineWidth = ow * 1.6;
        g.lineCap = "round";
        for (let i = 0; i < 10; i++) {
          const a1 = head - i * 0.11, a0 = a1 - 0.12;
          g.strokeStyle = "rgba(242,245,235," + (0.9 * fade * (1 - i / 10)).toFixed(3) + ")";
          g.beginPath(); g.arc(0, 0, Rc - ow / 2, a0, a1); g.stroke();
        }
      }
    }

    function drawCounter(clearK) {
      const Rc = L.Rc;
      const pop = 1 + V.numberPop * 0.12;
      g.save();
      g.scale(pop, pop);
      if (S.phase === "cleared" || S.phase === "outro") {
        // Remaining reached zero: the numeral resolves into a check.
        const out = clamp01(clearK * 5);              // 0 fades away first...
        if (out < 1) {
          g.globalAlpha = 1 - out;
          drawNumber("0", Rc);
          g.globalAlpha = 1;
        }
        const draw = easeOut(clamp01((clearK - 0.18) * 3)); // ...then the check is drawn in
        if (draw > 0) {
          const p0 = [-Rc * 0.3, Rc * 0.02], p1 = [-Rc * 0.08, Rc * 0.24], p2 = [Rc * 0.32, -Rc * 0.2];
          const l1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), l2 = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
          let d = draw * (l1 + l2);
          g.strokeStyle = C.lime;
          g.lineWidth = Math.max(2, Rc * 0.1);
          g.lineCap = "round"; g.lineJoin = "round";
          g.beginPath();
          g.moveTo(p0[0], p0[1]);
          const k1 = Math.min(1, d / l1);
          g.lineTo(p0[0] + (p1[0] - p0[0]) * k1, p0[1] + (p1[1] - p0[1]) * k1);
          if (d > l1) {
            const k2 = (d - l1) / l2;
            g.lineTo(p1[0] + (p2[0] - p1[0]) * k2, p1[1] + (p2[1] - p1[1]) * k2);
          }
          g.stroke();
        }
      } else if (S.phase !== "boot") {
        drawNumber(String(S.remaining), Rc);
      }
      g.restore();
    }

    function drawNumber(txt, Rc) {
      const size = Rc * (txt.length > 1 ? 0.66 : 0.76);
      g.font = "700 " + size.toFixed(1) + "px " + FONT;
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillStyle = C.white;
      g.fillText(txt, 0, size * 0.04);
    }

    function render() {
      const R = L.R;
      drawBackground();

      // Assembly transform: centre, impact recoil, failure jolt.
      let ox = 0, oy = 0;
      if (V.shake > 0) {
        const k = V.shake * V.shake;
        ox = Math.sin(V.time * 0.09) * R * 0.035 * k;
        oy = Math.cos(V.time * 0.12) * R * 0.018 * k;
      }
      oy -= V.impact * R * 0.012;
      const clearK = V.clearT < 0 ? -1 : clamp01(V.clearT / 700);
      const pulse = clearK >= 0 ? 1 + Math.sin(Math.PI * clamp01(V.clearT / 420)) * 0.04 : 1;
      const coreScale = (1 - V.impact * 0.035) * pulse;

      g.save();
      g.translate(L.cx + ox, L.cy + oy);

      // Faint red ring on failure.
      if (V.failFlash > 0) {
        g.strokeStyle = hexA(C.red, 0.35 * V.failFlash);
        g.lineWidth = 2;
        g.beginPath(); g.arc(0, 0, L.Rc * (1.1 + (1 - V.failFlash) * 0.9), 0, TAU); g.stroke();
      }

      // Attached pins (one shared rotation, each with its fixed local offset).
      const grow = easeOut(clamp01(V.introK)) * (1 - easeOut(clamp01(V.outroK)));
      g.save();
      g.scale(pulse, pulse);
      const n = S.attached.length;
      for (let i = 0; i < n; i++) {
        const p = S.attached[i];
        const ang = p.a + S.rot;
        const age = p.born < 0 ? 1e9 : V.time - p.born;
        let glow = age < 260 ? 1 - age / 260 : 0;
        if (clearK >= 0) {
          // Clear wave: tips light up in angular order from the launch point.
          const rel = (((ang - DOWN) % TAU) + TAU) % TAU / TAU;
          const w = clamp01(1 - Math.abs(clearK * 1.3 - rel) * 5);
          glow = Math.max(glow, w * 0.8);
        }
        const isHit = S.phase === "failed" && S.hit === i;
        const style = { glow, tipColor: isHit ? C.red : C.lime, tint: isHit ? "#c96a70" : null };
        if (p.born >= 0 && age < 70) {
          // A new pin's shaft snaps from the dart's head into the core socket.
          const rIn = L.R - L.stub + (L.Rc - (L.R - L.stub)) * easeOut(age / 70);
          style.len = L.R - rIn;
          drawPin(ang, rIn, style);
        } else {
          style.grow = Math.max(0.0001, p.born < 0 ? grow : 1 - easeOut(clamp01(V.outroK)));
          drawPin(ang, L.Rc, style);
        }
      }
      for (let i = 0; i < n; i++) drawSocket(S.attached[i].a + S.rot);
      g.restore();

      // Placement flashes at the attachment point (rotating with the assembly).
      for (const fl of V.flashes) {
        const k = fl.t / 240;
        const a = fl.a + S.rot;
        const x = Math.cos(a) * L.Rc, y = Math.sin(a) * L.Rc;
        g.strokeStyle = hexA(C.lime, 0.85 * (1 - k));
        g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, y, L.tip * (0.6 + k * 2.6), 0, TAU); g.stroke();
      }

      // Core and counter.
      g.save();
      g.scale(coreScale, coreScale);
      drawCore(V.failFlash, clearK);
      drawCounter(clearK);
      g.restore();

      // Launched or waiting pin (independent of the assembly).
      if (S.phase === "flying" || S.phase === "failed") {
        if (S.flight) {
          drawPin(DOWN, S.flight.d - L.stub, {
            len: L.stub,
            tipColor: S.phase === "failed" ? C.red : C.warm,
            waiting: S.phase !== "failed", tint: S.phase === "failed" ? "#c96a70" : null,
            glow: S.phase === "failed" ? 0.5 : 0
          });
        }
      } else if (S.phase === "ready" || S.phase === "intro") {
        const appear = S.phase === "intro" ? easeOut(clamp01(S.phaseT / 300)) : 1;
        const readyK = S.phase === "ready" ? easeOut(clamp01(S.phaseT / 120)) : 1;
        const hover = Math.sin(V.time / 520) * L.R * 0.006;
        const drop = (1 - readyK) * L.R * 0.08 + (1 - appear) * L.R * 0.1;
        g.globalAlpha = appear * (0.4 + 0.6 * readyK);
        drawPin(DOWN, L.d0 - L.stub + drop + hover, { len: L.stub, tipColor: C.warm, waiting: true });
        g.globalAlpha = 1;
      }
      g.restore();
    }

    function hexA(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return "rgba(" + (n >> 16) + "," + ((n >> 8) & 255) + "," + (n & 255) + "," + a.toFixed(3) + ")";
    }

    function stepVisuals(ms) {
      V.time += ms;
      const decay = (v, perMs) => Math.max(0, v - ms * perMs);
      V.impact = decay(V.impact, 1 / 170);
      V.numberPop = decay(V.numberPop, 1 / 160);
      V.shake = decay(V.shake, 1 / 300);
      V.failFlash = S.phase === "failed" ? Math.max(0.35, decay(V.failFlash, 1 / 500)) : decay(V.failFlash, 1 / 200);
      if (V.introK < 1) V.introK = Math.min(1, V.introK + ms / 300);
      if (S.phase === "outro") V.outroK = Math.min(1, V.outroK + ms / 200); else V.outroK = 0;
      if (V.clearT >= 0 && S.phase === "cleared") V.clearT += ms;
      for (const f of V.flashes) f.t += ms;
      while (V.flashes.length && V.flashes[0].t > 240) V.flashes.shift();
    }

    // =====================================================================
    // Animation loop
    // =====================================================================
    ctx.onResize(layout, { immediate: true });

    // First visible frame: the bare core, before any level is built.
    S.cfg = { launches: 1, difficulty: 0 };
    S.remaining = 0;
    S.attached = [];
    S.phase = "boot";
    render();
    ctx.markVisualReady("core");

    ctx.game.loop({
      maxDeltaMs: 50,
      update(dtMs) {
        if (S.phase !== "boot") stepRules(dtMs);
        stepVisuals(dtMs);
      },
      render
    });

    ctx.platform.ready();

    ctx.loadFont("Space Grotesk", "space-grotesk", "1.0.0", { weight: "300 700", style: "normal" }).catch(() => {});

    const resumeAt = await loadProgress();
    const first = Math.max(1, resumeAt || tune.startLevel());
    loadLevel(first);

    // Test hook, only when the local preview harness asks for it.
    if (!ctx.__testHooks) return;
    window.__spindle = {
      state: () => ({
        level: S.level, phase: S.phase, remaining: S.remaining, attached: S.attached.length,
        rot: S.rot, cfg: S.cfg && { pins: S.cfg.pins.length, launches: S.cfg.launches, w0: S.cfg.w0, mode: S.cfg.mode, peak: S.cfg.peak, sep: S.cfg.sep, sweep: S.cfg.sweep, difficulty: S.cfg.difficulty }
      }),
      generate: (lv) => { const c = generateLevel(lv); return { pins: c.pins.slice(), launches: c.launches, w0: c.w0, peak: c.peak, mode: c.mode, sep: c.sep, sweep: c.sweep, dir: c.dir, difficulty: c.difficulty }; },
      // Angular clearance from the launch axis to the nearest attached pin (rad).
      clearance: () => {
        let m = Infinity;
        for (const p of S.attached) {
          let d = Math.abs((((p.a + S.rot - DOWN) % TAU) + TAU + Math.PI) % TAU - Math.PI);
          m = Math.min(m, d);
        }
        return m;
      },
      worldAngles: () => S.attached.map((p) => p.a + S.rot),
      launchMs: () => tune.launchMs(),
      omegaNow: () => S.omega ? S.omega(S.t) : 0,
      tap: primaryAction
    };
    ctx.onDestroy(() => { try { delete window.__spindle; } catch (e) {} });
  }
};
