window.plethoraBit = {
  meta: {
    title: "Formula Rush",
    runtime: "plethora-bit@2",
    tags: ["racing", "3d", "formula", "arcade"],
    permissions: ["audio", "haptics", "motion", "storage"]
  },

  async init(ctx) {
    const TEST = ctx.__formulaRushTest || null;
    if (TEST) TEST.stats = { resets: [], walls: [] };
    let disposed = false;
    ctx.onDestroy(() => { disposed = true; });

    // =====================================================================
    // Settings
    // =====================================================================
    const DEFAULT_SETTINGS = {
      difficulty: "medium", laps: 3, racingLine: true, steering: "motion",
      sensitivity: 1, deadzone: 0.03, invertTilt: false, sound: true, volume: 0.8,
      brakeAssist: "auto", tc: "medium", ttLaps: 3, ghost: true,
      circuit: "aurora", vibration: true, view: 0, quality: "high", grid: 8, livery: 0, screenSide: "left", ver: 4
    };
    const settings = Object.assign({}, DEFAULT_SETTINGS);
    let bestLapStored = null;
    try {
      const saved = ctx.storage.get("settings");
      if (saved && typeof saved === "object") {
        // older saves predate the current defaults (tilt steering, Auto brake assist, Medium) and the retuned tilt
        if (saved.ver !== 4) { delete saved.steering; delete saved.brakeAssist; delete saved.difficulty; }
        if (saved.ver !== 3 && saved.ver !== 4) { delete saved.sensitivity; delete saved.deadzone; }
        for (const k of Object.keys(DEFAULT_SETTINGS)) {
          if (saved[k] !== undefined && typeof saved[k] === typeof DEFAULT_SETTINGS[k]) settings[k] = saved[k];
        }
      }
      const bl = ctx.storage.get("bestLap");
      if (typeof bl === "number" && isFinite(bl)) bestLapStored = bl;
    } catch (e) { /* storage optional */ }
    if (![3, 5, 10].includes(settings.laps)) settings.laps = 3;
    if (![6, 8, 10].includes(settings.grid)) settings.grid = 8;
    if (settings.view !== 0 && settings.view !== 1) settings.view = 0;
    if (!["off", "medium", "full", "auto"].includes(settings.brakeAssist)) settings.brakeAssist = "medium";
    if (settings.screenSide !== "left" && settings.screenSide !== "right") settings.screenSide = "left";
    if (![1, 3, 5, 10].includes(settings.ttLaps)) settings.ttLaps = 3;
    if (!["off", "medium", "full"].includes(settings.tc)) settings.tc = "medium";
    settings.ver = 4;
    let raceMode = "race", raceLaps = settings.laps;   // "race" against the AI grid, or "tt" (time trial, solo with ghost)
    function saveSettings() {
      try { ctx.storage.set("settings", settings); } catch (e) { /* ignore */ }
    }
    const tune = (id, fallback) => {
      try { const v = ctx.tune && ctx.tune.number(id); return (typeof v === "number" && isFinite(v)) ? v : fallback; }
      catch (e) { return fallback; }
    };

    // =====================================================================
    // Constants / helpers
    // =====================================================================
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lerp = (a, b, t) => a + (b - a) * t;
    const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
    const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
    let seed = 1337;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const rrange = (a, b) => a + (b - a) * rand();

    const fmtTime = ms => {
      if (ms == null || !isFinite(ms)) return "--:--.---";
      const neg = ms < 0; ms = Math.abs(ms);
      const m = Math.floor(ms / 60000);
      const s = Math.floor((ms % 60000) / 1000);
      const t = Math.floor(ms % 1000);
      return (neg ? "-" : "") + m + ":" + String(s).padStart(2, "0") + "." + String(t).padStart(3, "0");
    };

    const TEAMS = [
      { name: "Vortex Racing", code: "VTX", body: "#0fb5ae", accent: "#0b0f14", trim: "#e9fffd", num: 7 },
      { name: "Solaris GP", code: "SOL", body: "#ff6a13", accent: "#10204a", trim: "#ffffff", num: 11 },
      { name: "Kestrel Motorsport", code: "KES", body: "#f4f4f2", accent: "#d7192d", trim: "#1a1a1a", num: 3 },
      { name: "Nova Apex", code: "NOV", body: "#6a2bd9", accent: "#ffd31a", trim: "#ffffff", num: 22 },
      { name: "Ironleaf F1", code: "IRL", body: "#0f6b3c", accent: "#c9d1d3", trim: "#e8ff3a", num: 14 },
      { name: "Cobalt Strike", code: "CBS", body: "#1546d6", accent: "#ffffff", trim: "#ff2e63", num: 5 },
      { name: "Crimson Arrow", code: "CRA", body: "#b3001b", accent: "#1b1b1b", trim: "#ffc400", num: 16 },
      { name: "Aurum Dynamics", code: "AUR", body: "#151515", accent: "#d4a72c", trim: "#ffffff", num: 9 },
      { name: "Polaris Speed", code: "POL", body: "#8fd3ff", accent: "#0b2341", trim: "#ff4fa3", num: 31 },
      { name: "Ember Works", code: "EMB", body: "#3b3f46", accent: "#ff3d00", trim: "#fff2e0", num: 44 }
    ];
    const DRIVERS = ["ADLER", "BRAVO", "CASTA", "DUVAL", "EKBERG", "FARIA", "GRAHN", "HOLT", "IVANE", "JUNO", "KOVA"];

    // Physics constants (player and AI share them)
    const PHYS = {
      mass: 800, iz: 1150, a: 1.62, b: 1.48, hcg: 0.3, g: 9.81,
      mu: tune("grip", 1.75), power: tune("engine_power", 640) * 1000,
      cd: 0.62, kd: tune("downforce", 2.4), roll: 0.015,
      brakeMu: 0.95, steerMax: 0.36, steerMinHigh: 0.15
    };
    PHYS.L = PHYS.a + PHYS.b;
    // per-circuit dimensions (set by loadCircuitData); these defaults are Aurora Ring's
    let W = 7.5;              // half track width
    let CURB = 1.4;           // curb width
    let BARRIER_BASE = 19;    // default barrier distance from centerline
    let STREET = false;       // street circuits run wall-to-wall asphalt (no grass run-off)
    const GEARS = [0, 19, 30, 40, 50, 60, 70, 80, 200];
    const CAR_R = 1.0;        // collision circle radius
    const CAR_OFF = 1.45;     // circle offset front/rear

    // =====================================================================
    // DOM: root, styles, stage (landscape), loading screen
    // =====================================================================
    const root = ctx.createRoot({ layer: "overlay", input: "passthrough", style: "pointer-events:none;overflow:hidden;" });
    const style = document.createElement("style");
    style.textContent = `
      .fr-stage{position:absolute;left:0;top:0;font-family:"Bebas Neue",Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;pointer-events:none;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;overflow:hidden}
      .fr-stage *{box-sizing:border-box}
      .fr-ui{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
      .fr-panel{background:rgba(8,10,16,.62);border:1px solid rgba(255,255,255,.12);border-radius:10px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
      .fr-btn{pointer-events:auto;touch-action:none;cursor:pointer;border:1px solid rgba(255,255,255,.22);background:rgba(10,14,22,.55);color:#fff;border-radius:10px;font:inherit;letter-spacing:.06em;display:flex;align-items:center;justify-content:center;transition:transform .08s,background .12s}
      .fr-btn:active,.fr-btn.on{transform:scale(.96);background:rgba(255,255,255,.18)}
      .fr-accent{color:#ff2a3d}
      .fr-hide{display:none!important}
      .fr-screen{position:absolute;inset:0;pointer-events:none}
      .fr-menu-btn{pointer-events:auto;cursor:pointer;width:100%;padding:.55em 1em;margin:.32em 0;font-family:"Bebas Neue",Inter,system-ui,sans-serif;font-size:1.35em;letter-spacing:.08em;text-align:left;color:#fff;background:linear-gradient(90deg,rgba(255,42,61,.0),rgba(255,255,255,.04));border:0;border-left:4px solid rgba(255,255,255,.3);border-radius:4px;transition:all .12s}
      .fr-menu-btn:active,.fr-menu-btn:hover{border-left-color:#ff2a3d;background:linear-gradient(90deg,rgba(255,42,61,.35),rgba(255,255,255,.04))}
      .fr-menu-panel .fr-menu-btn{padding:.36em 1em;margin:.2em 0}
      .fr-menu-btn.primary{border-left-color:#ff2a3d;background:linear-gradient(90deg,rgba(255,42,61,.55),rgba(255,42,61,.08))}
      .fr-row{display:flex;align-items:center;justify-content:space-between;gap:.6em;padding:.38em 0;border-bottom:1px solid rgba(255,255,255,.07)}
      .fr-seg{display:flex;gap:.3em;flex-wrap:wrap;justify-content:flex-end}
      .fr-seg button{pointer-events:auto;cursor:pointer;font:600 .78em Inter,system-ui,sans-serif;color:#cfd6e4;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:6px;padding:.42em .7em;min-width:2.8em}
      .fr-seg button.sel{background:#ff2a3d;border-color:#ff2a3d;color:#fff}
      .fr-scroll{pointer-events:auto;overflow-y:auto;-webkit-overflow-scrolling:touch;touch-action:pan-y}
      .fr-light{width:1.5em;height:1.5em;border-radius:50%;background:#2a0b0e;border:2px solid #111;box-shadow:inset 0 0 6px #000}
      .fr-light.lit{background:radial-gradient(circle at 40% 35%,#ff8a8a,#ff1a1a 45%,#a00000);box-shadow:0 0 14px #ff2020,0 0 30px rgba(255,0,0,.55)}
      .fr-banner{position:absolute;left:50%;top:32%;transform:translate(-50%,-50%);font-size:3.2em;letter-spacing:.1em;padding:.05em .5em;border-radius:8px;background:rgba(6,8,14,.55);text-shadow:0 3px 14px rgba(0,0,0,.6);white-space:nowrap;transition:opacity .25s;pointer-events:none}
      .fr-lb-row{display:flex;gap:.45em;align-items:center;font:600 .72em Inter,system-ui,sans-serif;padding:.16em .4em;border-radius:4px;white-space:nowrap}
      .fr-lb-row.me{background:rgba(255,42,61,.85)}
      .fr-pedal{position:absolute;pointer-events:auto;touch-action:none;border-radius:18px;display:flex;align-items:center;justify-content:center;font-size:1.1em;letter-spacing:.1em;background:rgba(255,255,255,.10);border:2px solid rgba(255,255,255,.28);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
      .fr-pedal.on{background:rgba(255,255,255,.32);border-color:#fff}
      .fr-gas.on{background:rgba(46,230,120,.45);border-color:#2ee678}
      .fr-brake.on,.fr-brake.fr-auto{background:rgba(255,42,61,.5);border-color:#ff2a3d}
      .fr-small{position:absolute;pointer-events:auto;touch-action:none;width:2.6em;height:2.6em;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(10,14,22,.55);border:1px solid rgba(255,255,255,.25);font-size:1em}
      .fr-small.on{background:rgba(255,255,255,.3)}
      .fr-card{pointer-events:auto;cursor:pointer;display:flex;align-items:center;gap:.6em;padding:.45em .6em;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);margin-bottom:.35em;font:600 .8em Inter,system-ui,sans-serif}
      .fr-card.sel{border-color:#ff2a3d;background:rgba(255,42,61,.18)}
      .fr-sw{width:2.4em;height:1.3em;border-radius:4px;border:1px solid rgba(255,255,255,.3)}
      .fr-view{position:absolute;left:var(--vx);top:var(--vy);width:var(--vw);height:var(--vh);overflow:hidden;pointer-events:none}
      .fr-deck{position:absolute;left:0;right:0;top:var(--dk);bottom:0;display:none;flex-direction:column;gap:.6em;padding:.8em var(--pr) calc(var(--sb) + .8em) var(--pl);pointer-events:none;background:linear-gradient(180deg,#0b0f17,#05070b)}
      .fr-port .fr-deck{display:flex}
      .fr-docked{position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;transform:none!important;width:auto!important}
      .fr-deck-row{display:flex;gap:.6em;align-items:flex-start;justify-content:space-between}
      .fr-docked.fr-map{width:9.5em!important;height:9.5em!important}
      .fr-docked.fr-cars-col{flex:1;min-height:0}
      .fr-port .fr-res-left{position:relative!important;left:auto!important;top:auto!important;bottom:auto!important;width:auto!important;padding:1em var(--pl) 0!important}
      .fr-port .fr-res-right{position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;width:auto!important;margin:1em var(--pr) 1em var(--pl);max-height:50%}
      .fr-port .fr-results{overflow-y:auto;display:flex;flex-direction:column}
      .fr-ctl{position:absolute;inset:0;pointer-events:none}
      .fr-pedal{-webkit-touch-callout:none;user-select:none}
      .fr-cam{width:auto!important;padding:0 .7em;border-radius:1.3em!important;gap:.35em;font-size:.8em!important;letter-spacing:.08em}
      .fr-cam svg{width:1.25em;height:1.25em}
      .fr-cam.on{background:rgba(255,42,61,.85)!important;border-color:#ff2a3d!important}
      @keyframes frPulse{0%,100%{opacity:1}50%{opacity:.45}}
      .fr-pulse{animation:frPulse 1s infinite}
    `;
    root.appendChild(style);
    const stage = document.createElement("div");
    stage.className = "fr-stage";
    root.appendChild(stage);

    const el = (tag, cls, html, parent) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (html != null) e.innerHTML = html;
      (parent || stage).appendChild(e);
      return e;
    };

    const loading = el("div", "fr-screen", `
      <div style="position:absolute;inset:0;background:radial-gradient(ellipse at 50% 60%,#1d2433,#06080d 70%)"></div>
      <div style="position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);text-align:center">
        <div style="font-size:3.2em;letter-spacing:.12em">FORMULA <span class="fr-accent">RUSH</span></div>
        <div class="fr-ui fr-load-msg" style="opacity:.7;font-size:.85em;margin-top:.6em">Warming up tyres…</div>
        <div style="width:12em;height:4px;background:rgba(255,255,255,.12);margin:1em auto 0;border-radius:2px;overflow:hidden"><div class="fr-load-bar" style="width:15%;height:100%;background:#ff2a3d;transition:width .3s"></div></div>
        <button class="fr-btn fr-ui fr-retry fr-hide" style="margin:1.2em auto 0;padding:.6em 1.4em">Retry</button>
      </div>`);
    const loadMsg = loading.querySelector(".fr-load-msg");
    const loadBar = loading.querySelector(".fr-load-bar");

    // Layout. The game is always presented in landscape. A landscape container uses its full area as
    // the 3D view. A portrait container (host keeps the phone in portrait) gets the whole game, canvas
    // and HUD together, turned a quarter turn so it fills the phone held sideways.
    let SW = 800, SH = 400, portrait = false, rotated = 0, CW = 800, CH = 400;
    const VR = { x: 0, y: 0, w: 800, h: 400 };   // 3D view rect in container CSS pixels
    let deckTop = 400;
    let safe = { top: 0, right: 0, bottom: 0, left: 0 };
    const layoutListeners = [];
    const docks = [];   // [element, landscapeParent, portraitParent]
    function layout(info) {
      const w = (info && info.width) || ctx.width || 800;
      const h = (info && info.height) || ctx.height || 400;
      const sa = (info && info.safeArea) || ctx.safeArea || {};
      CW = w; CH = h;
      rotated = h > w ? (settings.screenSide === "right" ? -90 : 90) : 0;   // "left": phone turned with its top to the left
      const sT = sa.top || 0, sR = sa.right || 0, sB = sa.bottom || 0, sL = sa.left || 0;
      if (rotated === -90) safe = { top: sL, right: sT, bottom: sR, left: sB };
      else if (rotated === 90) safe = { top: sR, right: sB, bottom: sL, left: sT };
      else safe = { top: sT, right: sR, bottom: sB, left: sL };
      SW = rotated ? h : w; SH = rotated ? w : h;
      return layoutStage();
    }
    // CSS transform that turns a landscape SW x SH box into the portrait container
    function rotTransform() {
      return rotated === -90 ? `translateY(${CH}px) rotate(-90deg)` : rotated === 90 ? `translateX(${CW}px) rotate(90deg)` : "";
    }
    function layoutStage() {
      const w = SW, h = SH;
      portrait = false;
      stage.style.transformOrigin = "0 0";
      stage.style.transform = rotTransform();
      if (portrait) {
        VR.x = 0; VR.w = w; VR.h = Math.round(w * 9 / 16); VR.y = Math.round(safe.top);
        deckTop = VR.y + VR.h;
      } else {
        VR.x = 0; VR.y = 0; VR.w = w; VR.h = h; deckTop = h;
      }
      stage.style.width = w + "px";
      stage.style.height = h + "px";
      stage.classList.toggle("fr-port", portrait);
      const base = portrait ? clamp(w / 32, 11, 16) : clamp(Math.min(h / 22, w / 44), 11, 22);
      stage.style.fontSize = base + "px";
      const st = stage.style;
      st.setProperty("--vx", VR.x + "px"); st.setProperty("--vy", VR.y + "px");
      st.setProperty("--vw", VR.w + "px"); st.setProperty("--vh", VR.h + "px");
      st.setProperty("--dk", deckTop + "px");
      st.setProperty("--sb", safe.bottom + "px");
      // paddings inside the view rect (portrait view already sits below the top inset)
      st.setProperty("--pt", (portrait ? 8 : Math.max(10, safe.top + 8)) + "px");
      st.setProperty("--pr", Math.max(12, safe.right + 10) + "px");
      st.setProperty("--pb", (portrait ? 8 : Math.max(12, safe.bottom + 10)) + "px");
      st.setProperty("--pl", Math.max(12, safe.left + 10) + "px");
      for (const [elm, land, port] of docks) {
        const target = portrait ? port : land;
        if (elm.parentNode !== target) target.appendChild(elm);
        elm.classList.toggle("fr-docked", portrait);
      }
      for (const fn of layoutListeners) fn();
    }
    ctx.onResize(layout, { immediate: true });
    layout();
    ctx.markVisualReady("loading-screen");

    // Optional font (falls back to system fonts)
    ctx.loadFont("Bebas Neue", "bebas-neue", "1.0.0", { weight: "400" }).catch(() => {});

    // =====================================================================
    // Load three.js (with user-triggered retry)
    // =====================================================================
    let THREE = null;
    const retryBtn = loading.querySelector(".fr-retry");
    let loadingInFlight = false;
    async function loadThree() {
      if (loadingInFlight) return null;
      loadingInFlight = true;
      try {
        loadMsg.textContent = "Loading 3D engine…";
        const mod = await ctx.importModule("three", "0.164.1");
        return mod;
      } catch (err) {
        if (disposed) return null;
        ctx.platform.error({ stage: "dependency", message: String(err && err.message || err) });
        loadMsg.textContent = "Couldn't download the 3D engine. Check your connection.";
        retryBtn.classList.remove("fr-hide");
        return null;
      } finally {
        loadingInFlight = false;
      }
    }
    THREE = await loadThree();
    if (disposed) return;
    if (!THREE) {
      ctx.platform.ready();
      await new Promise(resolve => {
        ctx.input.activate(retryBtn, async () => {
          if (THREE || loadingInFlight) return;
          retryBtn.classList.add("fr-hide");
          THREE = await loadThree();
          if (THREE) resolve();
        });
      });
      if (disposed) return;
    }
    loadBar.style.width = "45%";
    loadMsg.textContent = "Building " + (({ monaco: "Monaco", silverstone: "Silverstone", suzuka: "Suzuka", marina: "Marina Bay" })[settings.circuit] || "Aurora Ring") + "…";

    // =====================================================================
    // Track generation
    // =====================================================================
    const CTRL = [
      [-300, 0], [0, 0], [300, 0], [400, 2],
      [445, 22], [458, 55], [440, 84], [405, 95],
      [330, 100], [275, 120], [240, 160], [228, 220],
      [230, 275], [244, 305], [232, 335], [218, 362], [224, 395],
      [230, 460], [215, 525], [160, 570], [70, 588],
      [-60, 588], [-170, 586],
      [-235, 568], [-272, 525], [-292, 455], [-330, 370], [-352, 260], [-360, 140],
      [-352, 65], [-330, 18]
    ];
    // Circuits. Aurora Ring uses the original CTRL layout and settings unchanged.
    const CIRCUITS = {
      aurora: {
        id: "aurora", record: "aurora_ring", name: "Aurora Ring", length: "2.5 km", ctrl: CTRL, sf: [-40, 0],
        W: 7.5, CURB: 1.4, BARRIER: 19, street: false, night: false,
        blurb: "Fast permanent circuit · long straight, hairpin, chicane",
        stands: [[-180, 120], [-40, 150], [130, 120], [560, 90]], trees: true, hills: 0x8aa39a, ground: "grass", groundCenter: [50, -290], lightSpacing: 120
      },
      monaco: {
        id: "monaco", record: "monaco", name: "Monaco", length: "3.3 km", sf: [205, -262],
        W: 5.5, CURB: 1.0, BARRIER: 7.1, street: true, night: false,
        blurb: "Harbour streets · Casino, hairpin, swimming pool",
        ctrl: [[231, -242], [248, -222], [265, -201], [282, -185], [295, -177], [309, -169], [332, -157], [350, -146], [370, -133], [380, -135], [388, -142], [396, -149], [408, -158], [432, -176],
          [454, -193], [474, -206], [497, -220], [519, -236], [541, -252], [560, -266], [579, -278], [596, -289], [612, -296], [629, -301], [647, -308], [674, -319], [692, -328], [707, -339],
          [725, -353], [749, -370], [767, -381], [781, -387], [794, -389], [807, -390], [819, -389], [831, -387], [841, -382], [850, -376], [857, -368], [863, -359], [869, -349], [873, -337],
          [876, -324], [876, -310], [877, -288], [880, -276], [885, -267], [894, -261], [903, -257], [913, -254], [927, -250], [945, -248], [968, -245], [996, -241], [1025, -237], [1054, -234],
          [1083, -230], [1094, -231], [1103, -235], [1109, -244], [1109, -254], [1106, -264], [1099, -272], [1090, -283], [1085, -301], [1082, -316], [1077, -335], [1076, -346], [1083, -353], [1092, -349],
          [1096, -340], [1096, -329], [1096, -319], [1099, -301], [1103, -291], [1110, -284], [1120, -282], [1130, -286], [1139, -290], [1151, -296], [1166, -304], [1176, -312], [1182, -321], [1182, -331],
          [1175, -339], [1167, -345], [1158, -352], [1144, -365], [1123, -383], [1100, -402], [1080, -418], [1063, -429], [1044, -440], [1023, -450], [1001, -459], [979, -467], [957, -474], [939, -477],
          [922, -478], [907, -477], [892, -474], [876, -469], [856, -461], [837, -454], [812, -445], [783, -437], [755, -429], [736, -420], [719, -412], [701, -402], [682, -390], [664, -377],
          [644, -363], [620, -345], [610, -342], [600, -345], [588, -350], [580, -343], [575, -334], [571, -323], [559, -310], [547, -302], [531, -290], [510, -274], [489, -257], [467, -239],
          [444, -221], [421, -203], [405, -192], [396, -187], [385, -187], [375, -190], [365, -194], [352, -199], [334, -206], [318, -216], [303, -227], [290, -239], [278, -251], [271, -261],
          [267, -271], [266, -282], [266, -302], [261, -314], [255, -324], [249, -334], [242, -344], [235, -355], [227, -365], [220, -375], [212, -385], [203, -394], [193, -401], [180, -403],
          [158, -418], [152, -428], [146, -438], [141, -448], [135, -462], [130, -477], [127, -494], [125, -509], [125, -522], [128, -536], [133, -552], [136, -571], [132, -580], [122, -583],
          [112, -580], [103, -574], [95, -568], [83, -560], [72, -550], [66, -541], [64, -531], [69, -522], [76, -515], [82, -501], [84, -486], [89, -466], [96, -446], [105, -425],
          [115, -403], [126, -381], [139, -359], [153, -335], [164, -318], [176, -302], [190, -287], [206, -270], [223, -251]],
        stands: [[-150, 90]], trees: false, hills: 0x9aa58e, ground: "city", lightSpacing: 70,
        buildings: { minH: 9, maxH: 30, colors: ["#e9d8bd", "#f2c9a0", "#d9b38c", "#f4e6cf", "#e7b8a4", "#cfd8c4", "#f0dca8"], depth: [10, 22], gap: 2.5 }
      },
      silverstone: {
        id: "silverstone", record: "silverstone", name: "Silverstone", length: "3.9 km", sf: [587, -130],
        W: 7.5, CURB: 1.4, BARRIER: 15, street: false, night: false,
        blurb: "Fast and flowing · Maggotts, Becketts, Stowe",
        ctrl: [[570, -122], [598, -143], [629, -165], [661, -188], [694, -212], [726, -235], [747, -254], [755, -266], [759, -279], [760, -293], [759, -310], [758, -329], [754, -360], [753, -388],
          [756, -406], [762, -422], [771, -437], [782, -452], [797, -470], [818, -494], [841, -521], [850, -536], [855, -549], [851, -562], [838, -569], [825, -573], [807, -578], [788, -586],
          [778, -596], [777, -609], [787, -619], [800, -625], [814, -627], [828, -628], [853, -633], [885, -639], [898, -635], [909, -626], [919, -615], [930, -601], [949, -579], [975, -549],
          [1002, -518], [1028, -487], [1054, -456], [1081, -425], [1107, -394], [1134, -364], [1160, -333], [1183, -305], [1192, -290], [1196, -276], [1195, -262], [1190, -249], [1181, -238], [1168, -232],
          [1154, -230], [1138, -229], [1111, -223], [1100, -214], [1093, -201], [1093, -187], [1098, -174], [1107, -164], [1120, -158], [1135, -158], [1148, -162], [1161, -168], [1178, -176], [1204, -188],
          [1234, -204], [1254, -218], [1269, -233], [1283, -249], [1293, -267], [1301, -285], [1306, -304], [1310, -327], [1313, -355], [1318, -392], [1323, -430], [1327, -469], [1331, -510], [1336, -550],
          [1338, -583], [1335, -600], [1330, -613], [1321, -624], [1310, -633], [1298, -641], [1282, -647], [1264, -653], [1237, -660], [1203, -669], [1165, -678], [1137, -682], [1107, -684], [1070, -687],
          [1029, -689], [999, -693], [979, -700], [957, -711], [932, -723], [917, -724], [903, -720], [890, -716], [869, -709], [838, -702], [823, -703], [809, -707], [797, -713], [782, -725],
          [749, -740], [735, -739], [722, -734], [710, -725], [701, -715], [692, -701], [679, -679], [664, -661], [649, -650], [633, -642], [613, -632], [581, -616], [545, -598], [509, -580],
          [473, -562], [437, -543], [401, -525], [365, -507], [328, -489], [295, -471], [264, -453], [235, -435], [210, -418], [194, -405], [185, -393], [179, -380], [177, -366], [179, -352],
          [183, -338], [190, -326], [200, -316], [212, -308], [227, -300], [249, -288], [275, -271], [295, -255], [316, -234], [342, -209], [370, -181], [390, -164], [396, -151], [391, -138],
          [381, -128], [379, -100], [388, -89], [399, -80], [411, -71], [426, -63], [442, -58], [457, -55], [471, -55], [484, -61], [496, -69], [510, -80], [533, -96], [564, -117]],
        stands: [[-230, 150], [-70, 110]], trees: true, hills: 0x8fa88f, ground: "grass", lightSpacing: 140
      },
      suzuka: {
        id: "suzuka", record: "suzuka", name: "Suzuka", length: "4.1 km", sf: [354, -911],
        W: 7.0, CURB: 1.3, BARRIER: 12, street: false, night: false, bridge: true,
        blurb: "Figure-eight · Esses, Spoon, 130R, crossover bridge",
        ctrl: [[676, -845], [592, -880], [465, -898], [349, -915], [211, -939], [127, -956], [63, -956], [28, -932], [17, -893], [32, -858], [66, -845], [116, -845],
          [163, -837], [198, -820], [229, -798], [265, -788], [306, -788], [346, -780], [384, -754], [420, -733], [454, -735], [486, -756], [518, -778], [552, -787],
          [586, -779], [618, -758], [645, -729], [668, -695], [678, -647], [672, -597], [657, -560], [640, -526], [634, -491], [645, -454], [664, -417], [687, -395],
          [740, -408], [803, -428], [898, -461], [926, -486], [951, -514], [974, -524], [987, -509], [974, -484], [949, -465], [919, -433], [914, -380], [922, -336],
          [935, -302], [964, -270], [997, -237], [1041, -203], [1099, -186], [1157, -185], [1215, -190], [1264, -196], [1300, -185], [1317, -153], [1314, -106], [1291, -76],
          [1258, -70], [1205, -87], [1131, -122], [1046, -167], [949, -229], [866, -298], [792, -354], [740, -412], [714, -454], [705, -507], [706, -565], [719, -624],
          [729, -682], [731, -714], [725, -731], [706, -740], [695, -761], [695, -792], [689, -824]],
        stands: [[-200, 140], [-40, 130]], trees: true, hills: 0x86a08e, ground: "grass", lightSpacing: 140
      },
      marina: {
        id: "marina", record: "marina_bay", name: "Marina Bay", length: "3.4 km", sf: [1177.5, -324.6],
        W: 6.5, CURB: 1.0, BARRIER: 9.5, street: true, night: true,
        blurb: "Floodlit night streets · 90° corners, Raffles, Anderson Bridge",
        ctrl: [[1191, -423], [1179, -340], [1166, -249], [1153, -158], [1138, -98], [1126, -82], [1104, -79], [1081, -74], [1069, -62], [1057, -48], [1043, -47], [1033, -57],
          [1030, -72], [1030, -106], [1037, -151], [1053, -204], [1066, -249], [1072, -283], [1066, -303], [1045, -314], [981, -312], [868, -306], [762, -300], [725, -285],
          [672, -255], [626, -228], [574, -198], [540, -181], [528, -181], [516, -195], [494, -226], [474, -254], [462, -278], [451, -293], [441, -294], [429, -282],
          [414, -260], [392, -230], [361, -213], [343, -219], [317, -249], [287, -302], [249, -362], [220, -414], [201, -450], [202, -476], [219, -497], [234, -509],
          [257, -518], [267, -528], [270, -551], [275, -577], [287, -596], [317, -615], [341, -636], [352, -654], [364, -667], [377, -667], [386, -651], [390, -626],
          [396, -544], [414, -460], [436, -389], [447, -355], [454, -334], [463, -320], [478, -323], [497, -337], [528, -366], [589, -415], [626, -428], [755, -436],
          [915, -445], [931, -453], [939, -476], [956, -497], [981, -502], [1132, -510], [1149, -504], [1166, -476], [1186, -445]],
        stands: [[-190, 110]], trees: false, hills: 0, ground: "city", lightSpacing: 34,
        buildings: { minH: 24, maxH: 110, colors: ["#2a3446", "#1f2a3a", "#33405a", "#26303f", "#3a4660"], depth: [16, 34], gap: 4, lit: true }
      }
    };
    if (!CIRCUITS[settings.circuit]) settings.circuit = "aurora";
    function catmullRom(P, n) {
      const out = [];
      const N = P.length;
      const tj = (ti, a, b) => ti + Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
      for (let i = 0; i < N; i++) {
        const p0 = P[(i - 1 + N) % N], p1 = P[i], p2 = P[(i + 1) % N], p3 = P[(i + 2) % N];
        const t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3);
        for (let k = 0; k < n; k++) {
          const t = t1 + (t2 - t1) * k / n;
          const pt = [];
          for (let c = 0; c < 2; c++) {
            const A1 = (t1 - t) / (t1 - t0) * p0[c] + (t - t0) / (t1 - t0) * p1[c];
            const A2 = (t2 - t) / (t2 - t1) * p1[c] + (t - t1) / (t2 - t1) * p2[c];
            const A3 = (t3 - t) / (t3 - t2) * p2[c] + (t - t2) / (t3 - t2) * p3[c];
            const B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2;
            const B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3;
            pt.push((t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2);
          }
          out.push(pt);
        }
      }
      return out;
    }
    function makeTrack(def) {
      const dense = catmullRom(def.ctrl, 40).map(p => [p[0], -p[1]]); // map y -> -z
      const cum = [0];
      for (let i = 1; i <= dense.length; i++) {
        const a = dense[i - 1], b = dense[i % dense.length];
        cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
      }
      const total = cum[cum.length - 1];
      const STEP = 2;
      const n = Math.floor(total / STEP);
      const ds = total / n;
      const raw = [];
      let j = 0;
      for (let i = 0; i < n; i++) {
        const s = i * ds;
        while (cum[j + 1] < s) j++;
        const a = dense[j], b = dense[(j + 1) % dense.length];
        const t = (s - cum[j]) / (cum[j + 1] - cum[j]);
        raw.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
      }
      // Re-index so sample 0 is the start/finish line on the main straight
      let sf = 0, best = 1e9;
      for (let i = 0; i < n; i++) {
        const p = raw[i];
        if (def.id === "aurora") { if (Math.abs(p[1]) < 3 && p[0] < 100) { const d = Math.abs(p[0] + 40); if (d < best) { best = d; sf = i; } } }
        else { const d = Math.hypot(p[0] - def.sf[0], p[1] + def.sf[1]); if (d < best) { best = d; sf = i; } }
      }
      const X = new Float32Array(n), Z = new Float32Array(n);
      for (let i = 0; i < n; i++) { const p = raw[(i + sf) % n]; X[i] = p[0]; Z[i] = p[1]; }
      const FX = new Float32Array(n), FZ = new Float32Array(n), RX = new Float32Array(n), RZ = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i - 1 + n) % n, b = (i + 1) % n;
        let fx = X[b] - X[a], fz = Z[b] - Z[a];
        const l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
        FX[i] = fx; FZ[i] = fz; RX[i] = -fz; RZ[i] = fx;
      }
      // curvature (positive = turning right)
      const K = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i - 3 + n) % n, b = (i + 3) % n;
        const cross = FX[a] * FZ[b] - FZ[a] * FX[b];
        K[i] = cross / (6 * ds);
      }
      const Ks = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let s = 0; for (let k = -4; k <= 4; k++) s += K[(i + k + n) % n]; Ks[i] = s / 9;
      }
      // barrier limits (inner side closer on tight corners)
      const limL0 = new Float32Array(n), limR0 = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let l = BARRIER_BASE, r = BARRIER_BASE;
        for (let k = -12; k <= 12; k++) {
          const kk = Ks[(i + k + n) % n];
          if (Math.abs(kk) > 1e-4) {
            const lim = Math.max(W + CURB + 2.2, 0.72 / Math.abs(kk));
            if (kk > 0) r = Math.min(r, lim); else l = Math.min(l, lim);
          }
        }
        limL0[i] = l; limR0[i] = r;
      }
      const limL = new Float32Array(n), limR = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        let sl = 0, sr = 0;
        for (let k = -6; k <= 6; k++) { sl += limL0[(i + k + n) % n]; sr += limR0[(i + k + n) % n]; }
        limL[i] = sl / 13; limR[i] = sr / 13;
      }
      // elevation: flat, except a figure-eight crossover where the later branch climbs over the earlier one
      const Y = new Float32Array(n);
      let bridge = null;
      if (def.bridge) {
        let bi = 0, bj = 0, bd = 1e9;
        for (let i = 0; i < n; i++) for (let j = i + 150; j < Math.min(n, n - 150 + i); j++) {
          const d = (X[i] - X[j]) * (X[i] - X[j]) + (Z[i] - Z[j]) * (Z[i] - Z[j]);
          if (d < bd) { bd = d; bi = i; bj = j; }
        }
        const H = 7.5, PLAT = 26, RAMP = 115;
        for (let k = 0; k < n; k++) {
          let a = Math.abs(k - bj); a = Math.min(a, n - a) * ds;
          const t = clamp(1 - (a - PLAT) / RAMP, 0, 1);
          Y[k] = H * t * t * (3 - 2 * t);
        }
        bridge = { lower: bi, upper: bj, H };
      }
      // where two parts of the circuit run side by side, share the space between them
      {
        const capL = new Float32Array(n).fill(1e9), capR = new Float32Array(n).fill(1e9);
        for (let i = 0; i < n; i++) for (let j = i + 60; j < Math.min(n, n - 60 + i); j++) {
          const dx = X[j] - X[i], dz = Z[j] - Z[i];
          if (Math.abs(dx) > 40 || Math.abs(dz) > 40 || Math.abs(Y[i] - Y[j]) > 3) continue;
          const d = Math.hypot(dx, dz);
          const li = dx * RX[i] + dz * RZ[i] < 0, lj = dx * RX[j] + dz * RZ[j] > 0;
          if (d > (li ? limL[i] : limR[i]) + (lj ? limL[j] : limR[j]) + 1) continue;
          const half = Math.max(W + CURB + 0.6, (d - 1) / 2);
          if (li) capL[i] = Math.min(capL[i], half); else capR[i] = Math.min(capR[i], half);
          if (lj) capL[j] = Math.min(capL[j], half); else capR[j] = Math.min(capR[j], half);
        }
        for (const [lim, cap] of [[limL, capL], [limR, capR]]) {
          for (let i = 0; i < n; i++) {
            let c = 1e9;
            for (let k = -10; k <= 10; k++) c = Math.min(c, cap[(i + k + n) % n] + Math.abs(k) * ds * 0.35);
            lim[i] = Math.min(lim[i], c);
          }
        }
      }
      // curbs on both sides through corners, gravel on outside of corners
      const curbL = new Uint8Array(n), curbR = new Uint8Array(n), gravelL = new Uint8Array(n), gravelR = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        let m = 0, sgn = 0;
        for (let k = -10; k <= 10; k++) { const kk = Ks[(i + k + n) % n]; if (Math.abs(kk) > m) { m = Math.abs(kk); sgn = Math.sign(kk); } }
        if (m > 1 / 170) { curbL[i] = 1; curbR[i] = 1; }
        let m2 = 0, sgn2 = 0;
        for (let k = -6; k <= 22; k++) { const kk = Ks[(i - k + n) % n]; if (Math.abs(kk) > m2) { m2 = Math.abs(kk); sgn2 = Math.sign(kk); } }
        if (!def.street && m2 > 1 / 110) { if (sgn2 > 0) gravelL[i] = 1; else gravelR[i] = 1; }
      }
      return { n, ds, length: n * ds, X, Z, Y, FX, FZ, RX, RZ, K: Ks, limL, limR, curbL, curbR, gravelL, gravelR, bridge };
    }
    let track = null, TN = 0, TDS = 2, TLEN = 1, racing = null, circuit = null;

    // nearest-point projection with a local search window
    function project(x, z, hint, out, wide) {
      const n = TN;
      let bi = hint, bd = 1e18;
      const win = wide ? n : 14;
      if (wide) {
        for (let i = 0; i < n; i += 2) {
          const dx = x - track.X[i], dz = z - track.Z[i]; const d = dx * dx + dz * dz;
          if (d < bd) { bd = d; bi = i; }
        }
        hint = bi;
      }
      const span = wide ? 4 : win;
      for (let k = -span; k <= span; k++) {
        const i = (hint + k + n) % n;
        const dx = x - track.X[i], dz = z - track.Z[i]; const d = dx * dx + dz * dz;
        if (d < bd) { bd = d; bi = i; }
      }
      // refine on segment
      const i0 = bi;
      const fx = track.FX[i0], fz = track.FZ[i0];
      const dx = x - track.X[i0], dz = z - track.Z[i0];
      const along = dx * fx + dz * fz;
      out.idx = i0;
      out.s = ((i0 * TDS + along) % TLEN + TLEN) % TLEN;
      out.d = dx * track.RX[i0] + dz * track.RZ[i0];
      return out;
    }
    const sampleAt = (s) => {
      const f = ((s / TDS) % TN + TN) % TN;
      const i = Math.floor(f), t = f - i, j = (i + 1) % TN;
      return {
        i, x: lerp(track.X[i], track.X[j], t), z: lerp(track.Z[i], track.Z[j], t), y: lerp(track.Y[i], track.Y[j], t),
        fx: lerp(track.FX[i], track.FX[j], t), fz: lerp(track.FZ[i], track.FZ[j], t),
        rx: lerp(track.RX[i], track.RX[j], t), rz: lerp(track.RZ[i], track.RZ[j], t)
      };
    };

    // Racing line: elastic band relaxation inside track limits
    function makeRacing() {
      const n = TN;
      const off = new Float32Array(n);
      const lim = W - 1.4;
      // minimise summed squared curvature (4th-difference flow) inside the track limits
      const px = new Float32Array(n), pz = new Float32Array(n);
      const dx = new Float32Array(n), dz = new Float32Array(n);
      for (const [k, iters] of [[8, 900], [4, 700], [2, 400]]) {
        for (let it = 0; it < iters; it++) {
          for (let i = 0; i < n; i++) { px[i] = track.X[i] + track.RX[i] * off[i]; pz[i] = track.Z[i] + track.RZ[i] * off[i]; }
          for (let i = 0; i < n; i++) {
            const a = (i - k + n) % n, b = (i + k) % n;
            dx[i] = px[a] - 2 * px[i] + px[b]; dz[i] = pz[a] - 2 * pz[i] + pz[b];
          }
          for (let i = 0; i < n; i++) {
            const a = (i - k + n) % n, b = (i + k) % n;
            const gx = dx[a] - 2 * dx[i] + dx[b], gz = dz[a] - 2 * dz[i] + dz[b];
            const g = gx * track.RX[i] + gz * track.RZ[i];
            off[i] = clamp(off[i] - 0.06 * g, -lim, lim);
          }
        }
      }
      const sm = new Float32Array(n);
      for (let i = 0; i < n; i++) { let s = 0; for (let k = -3; k <= 3; k++) s += off[(i + k + n) % n]; sm[i] = clamp(s / 7, -lim, lim); }
      const LX = new Float32Array(n), LZ = new Float32Array(n);
      for (let i = 0; i < n; i++) { LX[i] = track.X[i] + track.RX[i] * sm[i]; LZ[i] = track.Z[i] + track.RZ[i] * sm[i]; }
      // curvature of the line
      const kap = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const a = (i - 5 + n) % n, b = (i + 5) % n;
        const ax = LX[i] - LX[a], az = LZ[i] - LZ[a], bx = LX[b] - LX[i], bz = LZ[b] - LZ[i];
        const cx = LX[b] - LX[a], cz = LZ[b] - LZ[a];
        const cr = ax * bz - az * bx;
        kap[i] = 2 * Math.abs(cr) / (Math.hypot(ax, az) * Math.hypot(bx, bz) * Math.hypot(cx, cz) + 1e-6);
      }
      // speed profile
      const muE = PHYS.mu * (STREET ? 0.8 : 0.86), m = PHYS.mass;   // walls leave no margin on street circuits
      const v = new Float32Array(n);
      const VMAX = 95;
      for (let i = 0; i < n; i++) {
        const k = kap[i];
        const den = k - muE * PHYS.kd / m;
        v[i] = den <= 0 ? VMAX : Math.min(VMAX, Math.sqrt(muE * PHYS.g / den));
      }
      const segLen = TDS;
      for (let pass = 0; pass < 2; pass++) {
        for (let k = 2 * n; k > 0; k--) {
          const i = k % n, j = (k + 1) % n;
          const vv = v[j];
          const dec = 0.78 * PHYS.brakeMu * PHYS.mu * (PHYS.g + PHYS.kd * vv * vv / m) + PHYS.cd * vv * vv / m;
          v[i] = Math.min(v[i], Math.sqrt(vv * vv + 2 * dec * segLen));
        }
        for (let k = 0; k < 2 * n; k++) {
          const i = k % n, j = (k + 1) % n;
          const vv = Math.max(v[i], 5);
          const acc = Math.min(PHYS.power / (m * vv), PHYS.mu * PHYS.g * 0.55) - PHYS.cd * vv * vv / m;
          v[j] = Math.min(v[j], Math.sqrt(v[i] * v[i] + 2 * Math.max(acc, 0.1) * segLen));
        }
      }
      return { off: sm, X: LX, Z: LZ, kap, v };
    }
    function loadCircuitData(def) {
      circuit = def;
      W = def.W; CURB = def.CURB; BARRIER_BASE = def.BARRIER; STREET = !!def.street;
      track = makeTrack(def);
      TN = track.n; TDS = track.ds; TLEN = track.length;
      racing = makeRacing();
      try { const bl = ctx.storage.get(bestLapKey()); bestLapStored = (typeof bl === "number" && isFinite(bl)) ? bl : null; } catch (e) { bestLapStored = null; }
    }
    // Aurora Ring keeps its original storage key so existing personal bests survive
    function bestLapKey() { return circuit.id === "aurora" ? "bestLap" : "bestLap_" + circuit.id; }
    loadCircuitData(CIRCUITS[settings.circuit]);

    // =====================================================================
    // Renderer / scene
    // =====================================================================
    const canvas = ctx.createCanvas({ layer: "content", touchAction: "none" });
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    } catch (err) {
      ctx.platform.error({ stage: "renderer", message: String(err && err.message || err) });
      loadMsg.textContent = "Your device couldn't start the 3D renderer.";
      ctx.platform.ready();
      return;
    }
    ctx.onDestroy(() => { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) { /* ignore */ } });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = settings.quality === "high";
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    function applyRendererSize() {
      const q = settings.quality === "high" ? 2 : 1;
      renderer.setPixelRatio(Math.min(ctx.dpr || 1, q));
      renderer.setSize(SW, SH, false);
      if (rotated) {
        Object.assign(canvas.style, { position: "absolute", left: "0px", top: "0px", width: SW + "px", height: SH + "px", transformOrigin: "0 0", transform: rotTransform() });
      } else {
        Object.assign(canvas.style, { position: "", left: "", top: "", width: "100%", height: "100%", transformOrigin: "", transform: "" });
      }
    }
    applyRendererSize();
    layoutListeners.push(applyRendererSize);

    const scene = new THREE.Scene();
    const SKY_TOP = new THREE.Color("#3f7fd0"), SKY_HZ = new THREE.Color("#cfe3f2");
    scene.background = SKY_HZ.clone();
    scene.fog = new THREE.Fog(SKY_HZ.clone(), 260, 1150);
    const viewCam = new THREE.PerspectiveCamera(60, 2, 0.3, 2200);

    // Sky dome with vertex gradient
    {
      const g = new THREE.SphereGeometry(1800, 24, 12);
      const cols = [];
      const pos = g.attributes.position;
      const c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 1800;
        c.copy(SKY_HZ).lerp(SKY_TOP, clamp(y * 2.2, 0, 1));
        cols.push(c.r, c.g, c.b);
      }
      g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      const sky = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
      sky.renderOrder = -10;
      scene.add(sky);
      scene.userData.sky = sky;
    }

    const hemi = new THREE.HemisphereLight(0xd8ecff, 0x4a6b33, 0.9);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.4);
    sun.position.set(-120, 220, 90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -40; sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40; sun.shadow.camera.bottom = -40;
    sun.shadow.camera.near = 50; sun.shadow.camera.far = 420;
    sun.shadow.bias = -0.0006;
    scene.add(sun);
    scene.add(sun.target);
    const SUN_OFFSET = new THREE.Vector3(-120, 220, 90);

    // Environment map for glossy paint reflections
    {
      const envScene = new THREE.Scene();
      const g = new THREE.SphereGeometry(10, 32, 16);
      const cols = [];
      const pos = g.attributes.position;
      const c = new THREE.Color();
      const ground = new THREE.Color("#4d5a3c"), hz = new THREE.Color("#f2f6fb"), top = new THREE.Color("#4f8fe0");
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i) / 10;
        if (y < 0) c.copy(hz).lerp(ground, clamp(-y * 4, 0, 1)); else c.copy(hz).lerp(top, clamp(y * 1.6, 0, 1));
        cols.push(c.r, c.g, c.b);
      }
      g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
      envScene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      const sunBox = new THREE.Mesh(new THREE.SphereGeometry(1.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 3.8, 3.3) }));
      sunBox.position.set(-5, 7, 4);
      envScene.add(sunBox);
      const softbox = new THREE.Mesh(new THREE.PlaneGeometry(8, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.3, 1.3, 1.35), side: THREE.DoubleSide }));
      softbox.position.set(0, 9, 0); softbox.rotation.x = Math.PI / 2;
      envScene.add(softbox);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const rt = pmrem.fromScene(envScene, 0.02);
      scene.environment = rt.texture;
      pmrem.dispose();
      ctx.onDestroy(() => rt.dispose());
    }

    // ---------- procedural textures ----------
    function makeCanvas(w, h) {
      if (typeof OffscreenCanvas !== "undefined") {
        try { const c = new OffscreenCanvas(w, h); if (c.getContext("2d")) return c; } catch (e) { /* fallthrough */ }
      }
      // fallback: a hidden SDK-managed 2D surface used purely as a texture source
      const c = ctx.createCanvas2D({ layer: "background", input: "passthrough" });
      c.style.display = "none"; c.width = w; c.height = h;
      return c;
    }
    const disposables = [];
    function canvasTexture(w, h, draw, opts) {
      const c = makeCanvas(w, h);
      const g = c.getContext("2d");
      draw(g, w, h);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      if (opts && opts.repeat) { tex.wrapS = tex.wrapT = THREE.RepeatWrapping; }
      tex.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
      disposables.push(tex);
      return tex;
    }
    ctx.onDestroy(() => { for (const d of disposables) { try { d.dispose(); } catch (e) { /* ignore */ } } });
    const noiseFill = (g, w, h, base, spread, count, size) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      for (let i = 0; i < count; i++) {
        const v = Math.floor(rand() * spread * 2 - spread);
        g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
        const s = size * (0.5 + rand());
        g.fillRect(rand() * w, rand() * h, s, s);
      }
    };
    const asphaltTex = canvasTexture(256, 256, (g, w, h) => {
      noiseFill(g, w, h, "#3d4046", 34, 9000, 2);
      g.fillStyle = "rgba(0,0,0,0.07)";
      for (let i = 0; i < 40; i++) g.fillRect(rand() * w, 0, 1 + rand() * 3, h);
    }, { repeat: true });
    const grassTex = canvasTexture(256, 256, (g, w, h) => {
      noiseFill(g, w, h, "#4f7a32", 30, 7000, 3);
      g.globalAlpha = 0.18; g.fillStyle = "#6a9a3f";
      for (let i = 0; i < 8; i++) g.fillRect(0, i * 32, w, 16);
      g.globalAlpha = 1;
    }, { repeat: true });
    grassTex.repeat.set(220, 220);
    const gravelTex = canvasTexture(128, 128, (g, w, h) => noiseFill(g, w, h, "#b9a27c", 40, 5000, 2.5), { repeat: true });
    const curbTex = canvasTexture(64, 64, (g, w, h) => {
      g.fillStyle = "#e8e8e8"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#d4121e"; g.fillRect(0, 0, w, h / 2);
    }, { repeat: true });
    const wallTex = canvasTexture(128, 32, (g, w, h) => {
      g.fillStyle = "#dfe3e8"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#1c55c4"; g.fillRect(0, 0, w / 2, h);
      g.fillStyle = "rgba(0,0,0,.25)"; g.fillRect(0, h - 3, w, 3);
    }, { repeat: true });
    const fenceTex = canvasTexture(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = "rgba(210,220,230,0.75)"; g.lineWidth = 1.4;
      for (let i = -64; i < 128; i += 8) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke(); g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke(); }
      g.fillStyle = "rgba(90,96,104,1)"; g.fillRect(0, 0, 3, h);
    }, { repeat: true });
    const checkerTex = canvasTexture(64, 16, (g, w, h) => {
      for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? "#111" : "#f5f5f5"; g.fillRect(x * 4, y * 4, 4, 4); }
    });
    checkerTex.magFilter = THREE.NearestFilter;
    const rubberTex = canvasTexture(32, 64, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(0.5, "rgba(0,0,0,0.5)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    }, { repeat: true });
    const crowdTex = canvasTexture(256, 64, (g, w, h) => {
      g.fillStyle = "#2b2f38"; g.fillRect(0, 0, w, h);
      const cols = ["#e94b3c", "#f2f2f2", "#2d6cdf", "#f7c531", "#27ae60", "#8e44ad", "#ff7f50", "#111"];
      for (let y = 2; y < h; y += 6) for (let x = 1; x < w; x += 4) { g.fillStyle = cols[Math.floor(rand() * cols.length)]; g.fillRect(x + rand(), y, 3, 4); }
    }, { repeat: true });
    const blobTex = canvasTexture(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(32, 32, 4, 32, 32, 32);
      gr.addColorStop(0, "rgba(0,0,0,0.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const smokeTex = canvasTexture(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, "rgba(235,235,235,0.9)"); gr.addColorStop(1, "rgba(235,235,235,0)");
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const textTex = (text, fg, bg, w, h, font) => canvasTexture(w, h, (g) => {
      g.fillStyle = bg; g.fillRect(0, 0, w, h);
      g.fillStyle = fg; g.font = font || `bold ${Math.floor(h * 0.62)}px Inter, Arial, sans-serif`;
      g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, h / 2 + 2);
    });

    // ---------- ribbon builder ----------
    function ribbon(fromI, toI, offA, offB, y, mat, vScale, uFull, yB) {
      const pos = [], uv = [], idx = [];
      let vAcc = 0, count = 0;
      for (let k = fromI; k <= toI; k++) {
        const i = ((k % TN) + TN) % TN;
        const a = offA(i), b = offB(i);
        const ty = track.Y[i];
        pos.push(track.X[i] + track.RX[i] * a, y + ty, track.Z[i] + track.RZ[i] * a);
        pos.push(track.X[i] + track.RX[i] * b, (yB != null ? yB : y) + ty, track.Z[i] + track.RZ[i] * b);
        uv.push(0, vAcc / vScale, uFull || 1, vAcc / vScale);
        vAcc += TDS;
        if (count > 0) {
          const base = (count - 1) * 2;
          idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
        }
        count++;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      // ensure normals point up for horizontal ribbons
      const nrm = g.attributes.normal;
      if (yB == null) { for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, 0, 1, 0); }
      const mesh = new THREE.Mesh(g, mat);
      disposables.push(g);
      return mesh;
    }
    function runs(flags) {
      const out = [];
      let start = -1;
      for (let i = 0; i <= TN; i++) {
        const f = i < TN ? flags[i] : 0;
        if (f && start < 0) start = i;
        if (!f && start >= 0) { out.push([start, i]); start = -1; }
      }
      return out;
    }

    // ---------- circuit atmosphere (daylight for Aurora Ring / Monaco, floodlit night for Marina Bay) ----------
    const seedBeforeCity = seed;   // these textures must not shift the random sequence Aurora Ring's scenery uses
    const cityTex = canvasTexture(256, 256, (g, w, h) => {
      noiseFill(g, w, h, "#6a6c70", 20, 6000, 3);
      g.strokeStyle = "rgba(0,0,0,.18)"; g.lineWidth = 2;
      for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke(); }
    }, { repeat: true });
    cityTex.repeat.set(220, 220);
    const windowTex = canvasTexture(64, 128, (g, w, h) => {
      g.fillStyle = "#ffffff"; g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(40,48,60,.55)";
      for (let y = 6; y < h - 4; y += 16) for (let x = 5; x < w - 4; x += 14) g.fillRect(x, y, 9, 10);
    }, { repeat: true });
    const windowLitTex = canvasTexture(64, 128, (g, w, h) => {
      g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
      for (let y = 6; y < h - 4; y += 16) for (let x = 5; x < w - 4; x += 14) {
        if (rand() < 0.62) { g.fillStyle = rand() < 0.7 ? "#ffd79a" : "#bfe4ff"; g.fillRect(x, y, 9, 10); }
      }
    }, { repeat: true });
    seed = seedBeforeCity;
    const dayEnv = scene.environment;
    const ATMOS = {
      day: { top: "#3f7fd0", hz: "#cfe3f2", fogNear: 260, fogFar: 1150, hemiSky: 0xd8ecff, hemiGround: 0x4a6b33, hemiI: 0.9, sunC: 0xfff1dc, sunI: 2.4, exposure: 1.05 },
      night: { top: "#03050c", hz: "#141c30", fogNear: 160, fogFar: 950, hemiSky: 0x9fb4e6, hemiGround: 0x1a2030, hemiI: 0.8, sunC: 0xf4f6ff, sunI: 1.9, exposure: 1.12 }
    };
    function applyAtmosphere(def) {
      const A = def.night ? ATMOS.night : ATMOS.day;
      const top = new THREE.Color(A.top), hz = new THREE.Color(A.hz);
      scene.background.copy(hz); scene.fog.color.copy(hz); scene.fog.near = A.fogNear; scene.fog.far = A.fogFar;
      const sky = scene.userData.sky, pos = sky.geometry.attributes.position, col = sky.geometry.attributes.color, c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) { c.copy(hz).lerp(top, clamp(pos.getY(i) / 1800 * 2.2, 0, 1)); col.setXYZ(i, c.r, c.g, c.b); }
      col.needsUpdate = true;
      hemi.color.set(A.hemiSky); hemi.groundColor.set(A.hemiGround); hemi.intensity = A.hemiI;
      sun.color.set(A.sunC); sun.intensity = A.sunI;
      renderer.toneMappingExposure = A.exposure;
      scene.environment = def.night ? null : dayEnv;
    }
    // city blocks beside street circuits (instanced boxes, cleared from every part of the track)
    function addBuildings(def) {
      const B = def.buildings;
      const tmp = { idx: 0, s: 0, d: 0 };
      const items = [];
      const tryPlace = (x, z, rot, w, d, h) => {
        project(x, z, 0, tmp, true);
        const lim = tmp.d < 0 ? track.limL[tmp.idx] : track.limR[tmp.idx];
        if (Math.abs(tmp.d) - Math.hypot(w, d) / 2 < lim + 1.5) return;
        items.push({ x, z, rot, w, d, h, c: B.colors[Math.floor(rand() * B.colors.length)] });
      };
      for (let s = 0; s < TLEN; s += 15) {
        for (const side of [-1, 1]) {
          const sm = ((s % TLEN) + TLEN) % TLEN;
          if (side < 0 && (sm < 110 || sm > TLEN - 130)) continue;   // pit building
          let inStand = false;
          for (const [s0, len] of def.stands) { const a = ((s - s0) % TLEN + TLEN) % TLEN; if (side > 0 && a < len + 10) inStand = true; }
          if (inStand) continue;
          const p = sampleAt(s + rrange(-3, 3));
          const lim = side < 0 ? track.limL[p.i] : track.limR[p.i];
          const w = rrange(10, 17), d = rrange(B.depth[0], B.depth[1]);
          const off = side * (lim + B.gap + d / 2 + rrange(0, 4));
          tryPlace(p.x + p.rx * off, p.z + p.rz * off, Math.atan2(p.fx, p.fz), w, d, rrange(B.minH, B.maxH));
        }
      }
      if (B.lit) {
        // distant skyline ring
        const c = trackCenter();
        let r0 = 0;
        for (let i = 0; i < TN; i += 4) r0 = Math.max(r0, Math.hypot(track.X[i] - c[0], track.Z[i] - c[1]));
        for (let k = 0; k < 70; k++) {
          const a = (k / 70) * Math.PI * 2 + rrange(-0.03, 0.03), r = r0 + rrange(90, 390);
          items.push({ x: c[0] + Math.cos(a) * r, z: c[1] + Math.sin(a) * r, rot: rand() * 3, w: rrange(22, 40), d: rrange(22, 40), h: rrange(90, 230), c: B.colors[k % B.colors.length] });
        }
      }
      const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
      const map = windowTex.clone(); map.needsUpdate = true; map.repeat.set(1, B.lit ? 4 : 2);
      const matOpts = { map };
      if (B.lit) { const em = windowLitTex.clone(); em.needsUpdate = true; em.repeat.set(1, 4); Object.assign(matOpts, { emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 1.1 }); disposables.push(em); }
      const mat = new THREE.MeshLambertMaterial(matOpts);
      const inst = new THREE.InstancedMesh(geo, mat, items.length);
      const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
      items.forEach((b, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), b.rot);
        m4.compose(new THREE.Vector3(b.x, 0, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
        inst.setMatrixAt(i, m4);
        inst.setColorAt(i, col.set(b.c));
      });
      world.add(inst);
      disposables.push(geo, mat, map);
    }

    let world = null, guide = null, worldSeed = null;
    const startLights = [];
    const GRID_SLOT = k => ({ s: -10 - k * 8.5, d: (k % 2 === 0 ? -3.2 : 3.2) });
    function setStartLights(nLit) {
      startLights.forEach((lamps, i) => lamps.forEach(m => m.color.set(i < nLit ? 0xff1a1a : 0x220405)));
    }
    function trackCenter() {
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (let i = 0; i < TN; i++) { minX = Math.min(minX, track.X[i]); maxX = Math.max(maxX, track.X[i]); minZ = Math.min(minZ, track.Z[i]); maxZ = Math.max(maxZ, track.Z[i]); }
      return [(minX + maxX) / 2, (minZ + maxZ) / 2];
    }
    // Builds the scenery for the loaded circuit. Random placement is re-seeded so each circuit
    // (Aurora Ring included) always gets the same scenery.
    function buildWorld(def) {
    if (worldSeed === null) worldSeed = seed;
    seed = worldSeed;
    world = new THREE.Group();
    scene.add(world);
    const center = def.groundCenter || trackCenter();

    // Ground
    {
      const g = new THREE.PlaneGeometry(2600, 2600);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.MeshLambertMaterial({ map: def.ground === "city" ? cityTex : grassTex, polygonOffset: true, polygonOffsetFactor: 4, polygonOffsetUnits: 8 });
      const ground = new THREE.Mesh(g, m);
      ground.position.set(center[0], -0.15, center[1]);
      ground.receiveShadow = true;
      world.add(ground);
      disposables.push(g, m);
    }
    const matAsphalt = new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: 0.92, metalness: 0 });
    asphaltTex.repeat.set(1, 1);
    const trackMesh = ribbon(0, TN, () => -W, () => W, 0, matAsphalt, 4, 4);
    trackMesh.receiveShadow = true;
    world.add(trackMesh);
    // run-off margin (asphalt-ish darker) next to edges to give a sense of width
    const matRunoff = new THREE.MeshLambertMaterial({ color: 0x5c6c48, map: grassTex });
    const decal = { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 };
    const matGravel = new THREE.MeshLambertMaterial(Object.assign({ map: gravelTex }, decal));
    gravelTex.repeat.set(1, 1);
    for (const [a, b] of runs(track.gravelL)) world.add(ribbon(a, b, i => -track.limL[i] + 0.5, () => -(W + CURB), 0.012, matGravel, 6));
    for (const [a, b] of runs(track.gravelR)) world.add(ribbon(a, b, () => W + CURB, i => track.limR[i] - 0.5, 0.012, matGravel, 6));
    // white edge lines
    const matLine = new THREE.MeshBasicMaterial(Object.assign({ color: 0xf2f2f2 }, decal, { polygonOffsetUnits: -4 }));
    world.add(ribbon(0, TN, () => -W + 0.15, () => -W + 0.45, 0.02, matLine, 10));
    world.add(ribbon(0, TN, () => W - 0.45, () => W - 0.15, 0.02, matLine, 10));
    // curbs
    const matCurb = new THREE.MeshStandardMaterial(Object.assign({ map: curbTex, roughness: 0.6 }, decal));
    curbTex.repeat.set(1, 1);
    for (const [a, b] of runs(track.curbL)) world.add(ribbon(a, b, () => -(W + CURB), () => -W, 0.05, matCurb, 4, 1, 0.02));
    for (const [a, b] of runs(track.curbR)) world.add(ribbon(a, b, () => W, () => W + CURB, 0.02, matCurb, 4, 1, 0.05));
    // rubbered-in racing line
    {
      const m = new THREE.MeshBasicMaterial(Object.assign({ map: rubberTex, transparent: true, opacity: 0.38, depthWrite: false }, decal));
      world.add(ribbon(0, TN, i => racing.off[i] - 1.7, i => racing.off[i] + 1.7, 0.008, m, 30));
      disposables.push(m);
    }
    // barriers + catch fence
    const matWall = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, side: THREE.DoubleSide });
    wallTex.repeat.set(1, 1);
    const matFence = new THREE.MeshBasicMaterial({ map: fenceTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, alphaTest: 0.05 });
    fenceTex.repeat.set(1, 1);
    // heights are relative to the track surface; functions give absolute heights (bridge embankments)
    function wallRibbon(side, h0, h1, mat, vScale, from, to) {
      const pos = [], uv = [], idx = [];
      const f0 = from || 0, t0 = to == null ? TN : to;
      for (let k = f0; k <= t0; k++) {
        const i = ((k % TN) + TN) % TN;
        const off = side < 0 ? -track.limL[i] : track.limR[i];
        const x = track.X[i] + track.RX[i] * off, z = track.Z[i] + track.RZ[i] * off;
        pos.push(x, typeof h0 === "function" ? h0(i) : h0 + track.Y[i], z, x, typeof h1 === "function" ? h1(i) : h1 + track.Y[i], z);
        uv.push(k * TDS / vScale, 0, k * TDS / vScale, 1);
        if (k > f0) { const b = (k - f0 - 1) * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      disposables.push(g);
      return new THREE.Mesh(g, mat);
    }
    world.add(wallRibbon(-1, 0, 1.1, matWall, 6));
    world.add(wallRibbon(1, 0, 1.1, matWall, 6));
    world.add(wallRibbon(-1, 1.1, 4.2, matFence, 3.2));
    world.add(wallRibbon(1, 1.1, 4.2, matFence, 3.2));
    // crossover bridge: solid embankment up the ramps, an open deck where the lower branch passes beneath
    const nearDeck = new Uint8Array(TN);
    if (track.bridge) {
      const lo = track.bridge.lower, TY = track.Y, DECK = 1.2;
      const lowerClear = (x, z) => {
        let best = 1e18, bi = lo;
        for (let k = -80; k <= 80; k++) { const i = (lo + k + TN) % TN; const d = (x - track.X[i]) ** 2 + (z - track.Z[i]) ** 2; if (d < best) { best = d; bi = i; } }
        return Math.sqrt(best) - Math.max(track.limL[bi], track.limR[bi]) - 2;
      };
      const span = new Uint8Array(TN), raised = new Uint8Array(TN);
      for (let i = 0; i < TN; i++) {
        if (TY[i] <= 0.01) continue;
        raised[i] = 1;
        if (TY[i] < 4) continue;
        for (const off of [-track.limL[i], 0, track.limR[i]]) if (lowerClear(track.X[i] + track.RX[i] * off, track.Z[i] + track.RZ[i] * off) < 0) span[i] = 1;
      }
      for (let k = -80; k <= 80; k++) nearDeck[(lo + k + TN) % TN] = 1;
      for (let i = 0; i < TN; i++) if (raised[i]) nearDeck[i] = 1;
      const matConcrete = new THREE.MeshStandardMaterial({ color: 0xa8a69e, roughness: 0.85, side: THREE.DoubleSide });
      const base = i => span[i] ? TY[i] - DECK : 0;
      for (const [a, b] of runs(raised)) {
        world.add(wallRibbon(-1, base, i => TY[i], matConcrete, 6, a - 1, b));
        world.add(wallRibbon(1, base, i => TY[i], matConcrete, 6, a - 1, b));
        world.add(ribbon(a - 1, b, i => -track.limL[i], () => -W, -0.02, matRunoff, 8));
        world.add(ribbon(a - 1, b, () => W, i => track.limR[i], -0.02, matRunoff, 8));
      }
      for (const [a, b] of runs(span)) {
        world.add(ribbon(a, b - 1, i => -track.limL[i], i => track.limR[i], -DECK, matConcrete, 8));
        // abutments close the embankment at each end of the open span
        for (const i of [a, b - 1]) {
          const lx = track.X[i] - track.RX[i] * track.limL[i], lz = track.Z[i] - track.RZ[i] * track.limL[i];
          const rx = track.X[i] + track.RX[i] * track.limR[i], rz = track.Z[i] + track.RZ[i] * track.limR[i];
          const top = TY[i] - DECK + 0.05;
          const g = new THREE.BufferGeometry();
          g.setAttribute("position", new THREE.Float32BufferAttribute([lx, 0, lz, rx, 0, rz, lx, top, lz, rx, top, rz], 3));
          g.setIndex([0, 1, 2, 1, 3, 2]); g.computeVertexNormals();
          disposables.push(g);
          world.add(new THREE.Mesh(g, matConcrete));
        }
      }
      disposables.push(matConcrete);
    }

    // Start/finish line + grid boxes
    function placeOnTrack(obj, s, d, y, yawExtra) {
      const p = sampleAt(s);
      obj.position.set(p.x + p.rx * d, (y || 0) + p.y, p.z + p.rz * d);
      obj.rotation.y = Math.atan2(p.fx, p.fz) + (yawExtra || 0);
      return obj;
    }
    {
      const g = new THREE.PlaneGeometry(W * 2, 1.6); g.rotateX(-Math.PI / 2);
      const m = new THREE.MeshBasicMaterial(Object.assign({ map: checkerTex }, decal, { polygonOffsetUnits: -4 }));
      checkerTex.wrapS = THREE.RepeatWrapping; checkerTex.repeat.set(3, 1);
      world.add(placeOnTrack(new THREE.Mesh(g, m), 0, 0, 0.025));
      disposables.push(g, m);
    }
    {
      const g = new THREE.PlaneGeometry(2.6, 0.28); g.rotateX(-Math.PI / 2);
      for (let k = 0; k < 10; k++) {
        const sl = GRID_SLOT(k);
        world.add(placeOnTrack(new THREE.Mesh(g, matLine), sl.s + 2.9, sl.d, 0.024));
        const side = new THREE.PlaneGeometry(0.22, 1.4); side.rotateX(-Math.PI / 2);
        world.add(placeOnTrack(new THREE.Mesh(side, matLine), sl.s + 2.3, sl.d - 1.2, 0.024));
        world.add(placeOnTrack(new THREE.Mesh(side, matLine), sl.s + 2.3, sl.d + 1.2, 0.024));
        disposables.push(side);
      }
      disposables.push(g);
    }

    // Gantry with start lights
    startLights.length = 0;
    {
      const gantry = new THREE.Group();
      const steel = new THREE.MeshStandardMaterial({ color: 0x2a2f38, roughness: 0.5, metalness: 0.6 });
      const postG = new THREE.BoxGeometry(0.6, 8, 0.6);
      const p1 = new THREE.Mesh(postG, steel); p1.position.set(-(W + 2.2), 4, 0);
      const p2 = new THREE.Mesh(postG, steel); p2.position.set(W + 2.2, 4, 0);
      const beam = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 5, 1.4, 0.8), steel); beam.position.set(0, 7.6, 0);
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 + 4, 1.2), new THREE.MeshBasicMaterial({ map: textTex("FORMULA RUSH · " + def.name.toUpperCase(), "#ffffff", "#c8102e", 512, 48) }));
      banner.position.set(0, 7.6, -0.42); banner.rotation.y = Math.PI;
      const banner2 = banner.clone(); banner2.position.z = 0.42; banner2.rotation.y = 0;
      gantry.add(p1, p2, beam, banner, banner2);
      const podG = new THREE.BoxGeometry(0.9, 2.1, 0.5);
      const lampG = new THREE.CircleGeometry(0.3, 16);
      for (let i = 0; i < 5; i++) {
        const pod = new THREE.Mesh(podG, steel);
        const x = (i - 2) * 1.35;
        pod.position.set(x, 5.7, 0.1);
        gantry.add(pod);
        const lamps = [];
        for (let r = 0; r < 2; r++) {
          const lm = new THREE.MeshBasicMaterial({ color: 0x220405 });
          const lamp = new THREE.Mesh(lampG, lm);
          lamp.position.set(x, 6.15 - r * 0.85, -0.16); lamp.rotation.y = Math.PI;
          gantry.add(lamp); lamps.push(lm);
        }
        startLights.push(lamps);
      }
      for (const m of gantry.children) { if (m.isMesh) m.castShadow = true; }
      // gantry faces approaching cars (cars travel +s), so lamps face -forward
      world.add(placeOnTrack(gantry, 0.5, 0, 0));
    }
    // Trackside: grandstands, pit building, light towers, boards, trees, hills
    {
      const standMat = new THREE.MeshStandardMaterial({ color: 0x9aa3ad, roughness: 0.8 });
      const crowdMat = new THREE.MeshLambertMaterial({ map: crowdTex });
      crowdTex.repeat.set(6, 1);
      const roofMat = new THREE.MeshStandardMaterial({ color: 0xe8ecf0, roughness: 0.4, metalness: 0.3 });
      for (const [s0, len] of def.stands) {
        const grp = new THREE.Group();
        const base = new THREE.Mesh(new THREE.BoxGeometry(len, 2, 4), standMat); base.position.set(0, 1, 0);
        grp.add(base);
        for (let r = 0; r < 6; r++) {
          const step = new THREE.Mesh(new THREE.BoxGeometry(len, 1.1, 2.2), r % 2 ? standMat : standMat);
          step.position.set(0, 2.4 + r * 1.1, 1.5 + r * 2.0);
          grp.add(step);
          const crowd = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.0), crowdMat);
          crowd.position.set(0, 3.2 + r * 1.1, 0.45 + r * 2.0); crowd.rotation.x = -0.25; crowd.rotation.y = Math.PI;
          grp.add(crowd);
        }
        const back = new THREE.Mesh(new THREE.BoxGeometry(len, 10, 0.6), standMat); back.position.set(0, 5, 13.4);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 2, 0.5, 15), roofMat); roof.position.set(0, 11.5, 6.5); roof.rotation.x = 0.06;
        grp.add(back, roof);
        for (const m of grp.children) { m.castShadow = false; m.receiveShadow = false; }
        const p = sampleAt(s0 + len / 2);
        const i = p.i;
        const d = track.limR[i] + 6;
        grp.position.set(p.x + p.rx * d, 0, p.z + p.rz * d);
        grp.rotation.y = Math.atan2(p.fx, p.fz) - Math.PI / 2;
        world.add(grp);
      }
      // pit building on the inside of the main straight
      const pitMat = new THREE.MeshStandardMaterial({ color: 0xf1f3f5, roughness: 0.5 });
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x1c2a3a, roughness: 0.1, metalness: 0.8 });
      const pit = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(230, 9, 16), pitMat); body.position.set(0, 4.5, 0);
      const glass = new THREE.Mesh(new THREE.BoxGeometry(228, 3, 16.2), glassMat); glass.position.set(0, 6.2, 0);
      const garages = new THREE.Mesh(new THREE.PlaneGeometry(226, 4), new THREE.MeshLambertMaterial({ map: canvasTexture(512, 32, (g, w, h) => {
        for (let i = 0; i < 16; i++) { g.fillStyle = TEAMS[i % TEAMS.length].body; g.fillRect(i * 32 + 2, 4, 28, h - 4); g.fillStyle = "#1a1a1a"; g.fillRect(i * 32 + 4, 10, 24, h - 10); }
      }) }));
      garages.position.set(0, 2.1, -8.1); garages.rotation.y = Math.PI;
      const tower = new THREE.Mesh(new THREE.BoxGeometry(10, 22, 10), pitMat); tower.position.set(30, 11, 4);
      const towerGlass = new THREE.Mesh(new THREE.BoxGeometry(10.4, 4, 10.4), glassMat); towerGlass.position.set(30, 19, 4);
      pit.add(body, glass, garages, tower, towerGlass);
      const pp = sampleAt(-10);
      const pd = -(track.limL[pp.i] + 12);
      pit.position.set(pp.x + pp.rx * pd, 0, pp.z + pp.rz * pd);
      pit.rotation.y = Math.atan2(pp.fx, pp.fz) + Math.PI / 2;
      world.add(pit);
      // light towers
      const poleMat = new THREE.MeshStandardMaterial({ color: 0x777f88, roughness: 0.6, metalness: 0.5 });
      const headMat = new THREE.MeshBasicMaterial({ color: def.night ? 0xffffff : 0xfff8e0 });
      const poleG = new THREE.CylinderGeometry(0.25, 0.4, 22, 6);
      const headG = new THREE.BoxGeometry(3, 1.6, 0.6);
      const spacing = def.lightSpacing;
      for (let s = 0; s < TLEN; s += spacing) {
        const p = sampleAt(s);
        const side = (Math.floor(s / spacing) % 2) ? 1 : -1;
        if (nearDeck[p.i]) continue;
        const off = side > 0 ? track.limR[p.i] + 3 : -(track.limL[p.i] + 3);
        const pole = new THREE.Mesh(poleG, poleMat);
        pole.position.set(p.x + p.rx * off, 11, p.z + p.rz * off);
        const head = new THREE.Mesh(headG, headMat);
        head.position.set(pole.position.x, 22, pole.position.z);
        head.rotation.y = Math.atan2(p.fx, p.fz);
        world.add(pole, head);
      }
      // advertising boards (fictional) along straights
      const ads = ["APEX FUEL", "NIMBUS TELECOM", "KRONOS TIME", "HELIX TYRES", "ORBIT AIR", "VELA BANK"];
      const adCols = ["#ffd400", "#00b3ff", "#ff3b5c", "#21d07a", "#ffffff", "#ff8a00"];
      const adMats = ads.map((t, i) => new THREE.MeshBasicMaterial({ map: textTex(t, "#111", adCols[i], 256, 32), side: THREE.DoubleSide }));
      const adG = new THREE.PlaneGeometry(12, 1.5);
      let ai = 0;
      for (let s = 30; s < TLEN; s += 55) {
        const p = sampleAt(s);
        if (Math.abs(track.K[p.i]) > 1 / 300) continue;
        const side = ai % 2 ? 1 : -1;
        const off = side > 0 ? track.limR[p.i] - 0.25 : -(track.limL[p.i] - 0.25);
        const ad = new THREE.Mesh(adG, adMats[ai % ads.length]);
        ad.position.set(p.x + p.rx * off, 1.9 + p.y, p.z + p.rz * off);
        ad.rotation.y = Math.atan2(p.fx, p.fz) + (side > 0 ? Math.PI / 2 : -Math.PI / 2);
        world.add(ad);
        ai++;
      }
      // distance boards before heavy braking zones
      const boardMats = [150, 100, 50].map(n => new THREE.MeshBasicMaterial({ map: textTex(String(n), "#111", "#ffffff", 128, 96, "bold 64px Inter, Arial, sans-serif"), side: THREE.DoubleSide }));
      const boardG = new THREE.PlaneGeometry(1.6, 1.2);
      const postG2 = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 4);
      const v = racing.v;
      for (let i = 0; i < TN; i++) {
        const prev = (i - 1 + TN) % TN;
        // detect braking-zone start: speed profile begins dropping strongly
        if (v[prev] > v[i] + 0.12 && v[(prev - 1 + TN) % TN] <= v[prev] + 0.01) {
          let j = i, minV = v[i];
          while (v[(j + 1) % TN] < v[j % TN] + 0.01 && j - i < 200) { j++; minV = Math.min(minV, v[j % TN]); }
          if (v[prev] - minV < 22) continue;
          const turnIn = j * TDS;
          for (let b = 0; b < 3; b++) {
            const s = turnIn - [150, 100, 50][b];
            const p = sampleAt(s);
            const off = -(W + CURB + 2.4);
            const board = new THREE.Mesh(boardG, boardMats[b]);
            board.position.set(p.x + p.rx * off, 1.6 + p.y, p.z + p.rz * off);
            board.rotation.y = Math.atan2(p.fx, p.fz) + Math.PI;
            const post = new THREE.Mesh(postG2, poleMat);
            post.position.set(board.position.x, 0.6 + p.y, board.position.z);
            world.add(board, post);
          }
        }
      }
      if (def.buildings) addBuildings(def);
      // trees (instanced)
      if (def.trees) {
      const cell = 20, gridMap = new Map();
      for (let i = 0; i < TN; i += 2) {
        const key = Math.floor(track.X[i] / cell) + "," + Math.floor(track.Z[i] / cell);
        gridMap.set(key, true);
      }
      const nearTrack = (x, z, r) => {
        const cx = Math.floor(x / cell), cz = Math.floor(z / cell), rr = Math.ceil(r / cell);
        for (let a = -rr; a <= rr; a++) for (let b = -rr; b <= rr; b++) if (gridMap.has((cx + a) + "," + (cz + b))) return true;
        return false;
      };
      const treeCount = settings.quality === "high" ? 520 : 260;
      const foliage = new THREE.InstancedMesh(new THREE.ConeGeometry(3.2, 9, 7), new THREE.MeshLambertMaterial({ color: 0x2f5d2a }), treeCount);
      const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.35, 0.45, 3, 5), new THREE.MeshLambertMaterial({ color: 0x5b4330 }), treeCount);
      const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
      let placed = 0, guard = 0;
      while (placed < treeCount && guard < 20000) {
        guard++;
        const i = Math.floor(rand() * TN);
        const side = rand() < 0.5 ? -1 : 1;
        const off = side * (BARRIER_BASE + 14 + rand() * 120);
        const x = track.X[i] + track.RX[i] * off + rrange(-10, 10), z = track.Z[i] + track.RZ[i] * off + rrange(-10, 10);
        if (nearTrack(x, z, 30)) continue;
        const s = rrange(0.8, 1.5);
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
        sc.set(s, s * rrange(0.85, 1.3), s);
        ps.set(x, 4.5 * sc.y + 2.2, z);
        mtx.compose(ps, q, sc); foliage.setMatrixAt(placed, mtx);
        ps.set(x, 1.5 * s, z); sc.set(s, s, s);
        mtx.compose(ps, q, sc); trunks.setMatrixAt(placed, mtx);
        placed++;
      }
      foliage.count = placed; trunks.count = placed;
      world.add(foliage, trunks);
      }
      // distant hills
      if (def.hills) {
      const hillG = new THREE.CylinderGeometry(1400, 1500, 90, 48, 1, true);
      const hp = hillG.attributes.position;
      for (let i = 0; i < hp.count; i++) { if (hp.getY(i) > 0) hp.setY(i, 45 + Math.sin(i * 1.7) * 30 + Math.sin(i * 0.43) * 40); }
      hillG.computeVertexNormals();
      const hills = new THREE.Mesh(hillG, new THREE.MeshLambertMaterial({ color: def.hills, side: THREE.BackSide, fog: false }));
      hills.position.set(center[0], 10, center[1]);
      world.add(hills);
      }
    }

    // Racing-line guide (dashed strip with dynamic vertex colors)
    guide = (() => {
      const pos = [], col = [], idx = [];
      const DASH = 2; // samples per dash
      let v = 0;
      for (let i = 0; i < TN; i++) {
        if (i % 3 === 2) continue; // gap
        const j = (i + 1) % TN;
        for (const k of [i, j]) {
          const o = racing.off[k];
          pos.push(track.X[k] + track.RX[k] * (o - 0.45), 0.035 + track.Y[k], track.Z[k] + track.RZ[k] * (o - 0.45));
          pos.push(track.X[k] + track.RX[k] * (o + 0.45), 0.035 + track.Y[k], track.Z[k] + track.RZ[k] * (o + 0.45));
          col.push(0.2, 0.9, 0.5, 0.2, 0.9, 0.5);
        }
        idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
        v += 4;
      }
      void DASH;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      g.setIndex(idx);
      const m = new THREE.MeshBasicMaterial(Object.assign({ vertexColors: true, transparent: true, opacity: 0.6, depthWrite: false }, decal, { polygonOffsetUnits: -6 }));
      const mesh = new THREE.Mesh(g, m);
      mesh.renderOrder = 2;
      mesh.userData.keep = true;
      world.add(mesh);
      disposables.push(g, m);
      // map sample -> vertex base indices
      const map = new Int32Array(TN).fill(-1);
      let vb = 0;
      for (let i = 0; i < TN; i++) { if (i % 3 === 2) continue; map[i] = vb; vb += 4; }
      return { mesh, colors: g.attributes.color, map };
    })();
    batchWorld();
    applyAtmosphere(def);
    }
    buildWorld(circuit);

    loadBar.style.width = "70%";

    // =====================================================================
    // Car model
    // =====================================================================
    function mergeGeos(list) {
      // list: [{geo, matrix}] -> single non-indexed geometry
      let total = 0;
      const prepared = list.map(({ geo, matrix }) => {
        const g = geo.index ? geo.toNonIndexed() : geo.clone();
        if (matrix) g.applyMatrix4(matrix);
        if (!g.attributes.normal) g.computeVertexNormals();
        total += g.attributes.position.count;
        return g;
      });
      const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), uv = new Float32Array(total * 2);
      let o = 0;
      for (const g of prepared) {
        pos.set(g.attributes.position.array, o * 3);
        nrm.set(g.attributes.normal.array, o * 3);
        if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
        o += g.attributes.position.count;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      out.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
      return out;
    }
    const M4 = (x, y, z, rx, ry, rz, sx, sy, sz) => {
      const m = new THREE.Matrix4();
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx || 0, ry || 0, rz || 0)), new THREE.Vector3(sx || 1, sy || 1, sz || 1));
      return m;
    };
    // Tapered box helper (front narrower)
    function taperBox(w0, h0, w1, h1, len) {
      const g = new THREE.BoxGeometry(1, 1, len, 1, 1, 1);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const z = p.getZ(i);
        const t = z > 0 ? 1 : 0;
        p.setX(i, p.getX(i) * (t ? w1 : w0));
        p.setY(i, p.getY(i) * (t ? h1 : h0));
      }
      g.computeVertexNormals();
      return g;
    }
    // Lofted superellipse body sections: [z, width, height, yCenter]
    function loft(sections, segs, exp, xOff, flatBottom) {
      const ring = segs;
      const pos = [], idx = [];
      for (const [z, w, h, yc] of sections) {
        for (let k = 0; k < ring; k++) {
          const t = (k / ring) * Math.PI * 2;
          const c = Math.cos(t), sn = Math.sin(t);
          const x = (w / 2) * Math.sign(c) * Math.pow(Math.abs(c), 2 / exp);
          let y = yc + (h / 2) * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / exp);
          if (flatBottom != null) y = Math.max(y, flatBottom);
          pos.push(x + (xOff || 0), y, z);
        }
      }
      const S = sections.length;
      for (let i = 0; i < S - 1; i++) {
        for (let k = 0; k < ring; k++) {
          const a = i * ring + k, b = i * ring + (k + 1) % ring, c = (i + 1) * ring + k, d = (i + 1) * ring + (k + 1) % ring;
          idx.push(a, c, b, b, c, d);
        }
      }
      // end caps (fan around centroid)
      for (const [si, flip] of [[0, true], [S - 1, false]]) {
        const [z, , , yc] = sections[si];
        const ci = pos.length / 3;
        pos.push(xOff || 0, yc, z);
        for (let k = 0; k < ring; k++) {
          const a = si * ring + k, b = si * ring + (k + 1) % ring;
          if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }
    // merge with per-part vertex colours: entries { geo, matrix, color: (x,y,z,ny) => [r,g,b] | [r,g,b] }
    function mergeColored(list) {
      let total = 0;
      const prepared = list.map(({ geo, matrix, color }) => {
        const g = geo.index ? geo.toNonIndexed() : geo.clone();
        if (matrix) g.applyMatrix4(matrix);
        g.computeVertexNormals();
        total += g.attributes.position.count;
        return { g, color };
      });
      const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), col = new Float32Array(total * 3);
      let o = 0;
      for (const { g, color } of prepared) {
        const p = g.attributes.position, n = g.attributes.normal;
        pos.set(p.array, o * 3); nrm.set(n.array, o * 3);
        for (let i = 0; i < p.count; i++) {
          const c = typeof color === "function" ? color(p.getX(i), p.getY(i), p.getZ(i), n.getY(i)) : color;
          col[(o + i) * 3] = c[0]; col[(o + i) * 3 + 1] = c[1]; col[(o + i) * 3 + 2] = c[2];
        }
        o += p.count;
        g.dispose();
      }
      const out = new THREE.BufferGeometry();
      out.setAttribute("position", new THREE.BufferAttribute(pos, 3));
      out.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
      out.setAttribute("color", new THREE.BufferAttribute(col, 3));
      return out;
    }
    const linCol = hex => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
    // insert interpolated sections so colour boundaries along z stay crisp
    function withCuts(sections, cuts) {
      const out = sections.slice();
      for (const z of cuts) {
        for (let i = 0; i < out.length - 1; i++) {
          const a = out[i], b = out[i + 1];
          if ((z - a[0]) * (z - b[0]) < 0) {
            const t = (z - a[0]) / (b[0] - a[0]);
            out.splice(i + 1, 0, a.map((v, k) => k === 0 ? z : lerp(v, b[k], t)));
            break;
          }
        }
      }
      return out;
    }
    const CHASSIS = [
      [-2.42, 0.22, 0.26, 0.42], [-2.1, 0.36, 0.4, 0.47], [-1.6, 0.52, 0.56, 0.54], [-1.0, 0.66, 0.68, 0.6],
      [-0.5, 0.8, 0.74, 0.6], [-0.15, 0.86, 0.62, 0.53], [0.55, 0.8, 0.5, 0.49], [1.25, 0.6, 0.42, 0.45],
      [1.9, 0.42, 0.32, 0.4], [2.6, 0.28, 0.22, 0.33], [3.12, 0.17, 0.13, 0.26], [3.3, 0.08, 0.07, 0.24]
    ];
    const POD = [[0.62, 0.36, 0.34, 0.4], [0.45, 0.52, 0.5, 0.42], [-0.2, 0.52, 0.48, 0.41], [-0.85, 0.42, 0.38, 0.37], [-1.4, 0.26, 0.24, 0.31], [-1.8, 0.1, 0.1, 0.26]];
    const HOOP = [[-0.78, 0.16, 0.08, 0.92], [-0.55, 0.28, 0.36, 1.0], [-0.32, 0.3, 0.38, 1.02], [-0.22, 0.26, 0.3, 1.02]];
    const paintParts = (() => {
      const P = [];
      P.push({ geo: loft(withCuts(CHASSIS, [2.72, 2.78, -1.72, -1.78, 0.9, 0.96]), 24, 2.6, 0, 0.17), key: "chassis" });
      P.push({ geo: loft(withCuts(POD, [0.33, 0.37]), 16, 3, -0.62, 0.15), key: "pod" });
      P.push({ geo: loft(withCuts(POD, [0.33, 0.37]), 16, 3, 0.62, 0.15), key: "pod" });
      P.push({ geo: loft(HOOP, 14, 2.4, 0), key: "hoop" });
      // shark fin
      P.push({ geo: taperBox(0.035, 0.42, 0.035, 0.08, 1.35), matrix: M4(0, 0.98, -1.55), key: "fin" });
      // endplates
      for (const sx of [-1, 1]) {
        P.push({ geo: new THREE.BoxGeometry(0.035, 0.3, 0.62), matrix: M4(sx * 0.97, 0.24, 3.28), key: "endplate" });
        P.push({ geo: new THREE.BoxGeometry(0.04, 0.72, 0.78), matrix: M4(sx * 0.62, 0.8, -2.5), key: "endplate" });
      }
      // nose pylons
      P.push({ geo: new THREE.BoxGeometry(0.03, 0.12, 0.3), matrix: M4(-0.07, 0.17, 3.18), key: "pylon" });
      P.push({ geo: new THREE.BoxGeometry(0.03, 0.12, 0.3), matrix: M4(0.07, 0.17, 3.18), key: "pylon" });
      return P;
    })();
    const paintGeoCache = new Map();
    function paintGeometry(t) {
      if (paintGeoCache.has(t)) return paintGeoCache.get(t);
      const team = TEAMS[t];
      const B = linCol(team.body), A = linCol(team.accent), T = linCol(team.trim);
      const fn = key => (x, y, z, ny) => {
        if (key === "chassis") {
          if (z > 2.75) return A;                       // nose tip
          if (z < -1.75) return A;                      // gearbox / tail
          if (y < 0.3) return A;                        // lower flanks
          if (z > 0.93 && z < 2.75 && ny > 0.5) return T; // nose top flash
          return B;
        }
        if (key === "pod") return y < 0.3 ? A : (z > 0.35 ? T : B);
        if (key === "hoop") return A;
        if (key === "fin") return z < -1.9 ? T : B;
        if (key === "endplate") return y > 0.95 || (z > 3 && y > 0.3) ? T : B;
        return A;
      };
      const CARBON = linCol("#17191d");
      const list = paintParts.map(p => ({ geo: p.geo, matrix: p.matrix, color: fn(p.key) }));
      for (const part of carParts.accent) list.push({ geo: part.geo, matrix: part.matrix, color: A });
      for (const part of carParts.carbon) list.push({ geo: part.geo, matrix: part.matrix, color: CARBON });
      for (const part of carParts.trim) list.push({ geo: part.geo, matrix: part.matrix, color: T });
      list.push({ geo: carParts.rain, matrix: M4(0, 0.42, -2.44), color: [4, 0.1, 0.1] });
      const g = mergeColored(list);
      const hg = mergeColored([
        { geo: carParts.helmet, color: T },
        { geo: carParts.visor, color: [0.01, 0.01, 0.012] }
      ]);
      disposables.push(g, hg);
      const res = { body: g, helmet: hg };
      paintGeoCache.set(t, res);
      return res;
    }
    // Shared geometry (built once)
    const carParts = {};
    const carGeo = (() => {
      const accent = [], carbon = [], trim = [];
      // front wing: main plane + two flaps that rise toward the tips
      accent.push({ geo: new THREE.BoxGeometry(1.92, 0.035, 0.46), matrix: M4(0, 0.11, 3.3, -0.04) });
      for (const sx of [-1, 1]) {
        accent.push({ geo: new THREE.BoxGeometry(0.62, 0.025, 0.22), matrix: M4(sx * 0.64, 0.2, 3.18, -0.42, 0, sx * 0.08) });
        accent.push({ geo: new THREE.BoxGeometry(0.62, 0.025, 0.16), matrix: M4(sx * 0.64, 0.28, 3.06, -0.7, 0, sx * 0.1) });
      }
      // rear wing: main plane + top flap + beam wing
      accent.push({ geo: new THREE.BoxGeometry(1.22, 0.05, 0.42), matrix: M4(0, 0.98, -2.56, 0.12) });
      accent.push({ geo: new THREE.BoxGeometry(1.22, 0.035, 0.26), matrix: M4(0, 1.12, -2.38, 0.5) });
      carbon.push({ geo: new THREE.BoxGeometry(0.9, 0.035, 0.2), matrix: M4(0, 0.48, -2.42, 0.2) });
      carbon.push({ geo: new THREE.BoxGeometry(0.05, 0.52, 0.1), matrix: M4(0, 0.7, -2.45) });
      // cockpit opening, intake mouths
      carbon.push({ geo: loft([[-0.1, 0.48, 0.05, 0.775], [0.35, 0.5, 0.06, 0.745], [0.85, 0.36, 0.05, 0.71]], 14, 2.4, 0) });
      carbon.push({ geo: new THREE.BoxGeometry(0.2, 0.18, 0.04), matrix: M4(0, 1.04, -0.21) });
      for (const sx of [-1, 1]) carbon.push({ geo: new THREE.BoxGeometry(0.34, 0.3, 0.03), matrix: M4(sx * 0.62, 0.42, 0.63) });
      // floor with edge fences, diffuser
      carbon.push({ geo: new THREE.BoxGeometry(1.52, 0.04, 3.1), matrix: M4(0, 0.09, -0.45) });
      for (const sx of [-1, 1]) carbon.push({ geo: new THREE.BoxGeometry(0.03, 0.12, 2.6), matrix: M4(sx * 0.76, 0.14, -0.45) });
      carbon.push({ geo: new THREE.BoxGeometry(1.0, 0.04, 0.6), matrix: M4(0, 0.2, -2.25, -0.32) });
      // mirrors on stalks
      for (const sx of [-1, 1]) {
        carbon.push({ geo: new THREE.BoxGeometry(0.17, 0.08, 0.06), matrix: M4(sx * 0.56, 0.86, 0.72) });
        carbon.push({ geo: new THREE.BoxGeometry(0.2, 0.02, 0.03), matrix: M4(sx * 0.45, 0.8, 0.72, 0, 0, sx * 0.4) });
      }
      // halo
      trim.push({ geo: new THREE.TorusGeometry(0.36, 0.035, 6, 20, Math.PI), matrix: M4(0, 0.9, 0.2, -Math.PI / 2, 0, 0) });
      carbon.push({ geo: new THREE.CylinderGeometry(0.018, 0.026, 0.4, 6), matrix: M4(0, 0.83, 0.62, 0.75) });
      trim.push({ geo: new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), matrix: M4(-0.36, 0.83, 0.02, 0, 0, 0.14) });
      trim.push({ geo: new THREE.CylinderGeometry(0.03, 0.03, 0.4, 6), matrix: M4(0.36, 0.83, 0.02, 0, 0, -0.14) });
      // suspension wishbones + push rods
      const arm = (x0, y0, z0, x1, y1, z1, r) => {
        const dx = x1 - x0, dy = y1 - y0, dz = z1 - z0;
        const len = Math.hypot(dx, dy, dz);
        const geo = new THREE.CylinderGeometry(r || 0.022, r || 0.022, len, 5);
        const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize());
        const m = new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), qq, new THREE.Vector3(1, 1, 1));
        carbon.push({ geo, matrix: m });
      };
      for (const sx of [-1, 1]) {
        arm(sx * 0.2, 0.5, 1.85, sx * 0.72, 0.46, 1.62); arm(sx * 0.2, 0.5, 1.4, sx * 0.72, 0.46, 1.62);
        arm(sx * 0.2, 0.3, 1.85, sx * 0.72, 0.27, 1.62); arm(sx * 0.2, 0.3, 1.4, sx * 0.72, 0.27, 1.62);
        arm(sx * 0.3, 0.52, -1.25, sx * 0.72, 0.48, -1.48); arm(sx * 0.3, 0.3, -1.7, sx * 0.72, 0.27, -1.48);
        arm(sx * 0.25, 0.62, 1.55, sx * 0.7, 0.3, 1.62, 0.018);
      }
      carParts.accent = accent; carParts.carbon = carbon; carParts.trim = trim;
      carParts.helmet = mergeGeos([{ geo: new THREE.SphereGeometry(0.17, 16, 12), matrix: M4(0, 0.97, 0.12, 0, 0, 0, 1, 1, 1.12) }]);
      carParts.visor = mergeGeos([{ geo: new THREE.SphereGeometry(0.172, 14, 8, -0.9, 1.8, 1.1, 0.55), matrix: M4(0, 0.97, 0.12, 0, 0, 0, 1, 1, 1.12) }]);
      carParts.rain = new THREE.BoxGeometry(0.16, 0.06, 0.03);
      // tyres: lathe a rounded profile around the axle
      const tyreGeo = (R, wdt) => {
        const pts = [];
        const r0 = R * 0.62, sh = 0.06;
        pts.push(new THREE.Vector2(r0, -wdt / 2));
        for (let k = 0; k <= 6; k++) { const a = -Math.PI / 2 + (k / 6) * Math.PI / 2; pts.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, -wdt / 2 + sh + Math.sin(a) * sh)); }
        for (let k = 0; k <= 6; k++) { const a = (k / 6) * Math.PI / 2; pts.push(new THREE.Vector2(R - sh + Math.cos(a) * sh, wdt / 2 - sh + Math.sin(a) * sh)); }
        pts.push(new THREE.Vector2(r0, wdt / 2));
        const g = new THREE.LatheGeometry(pts, 26);
        g.rotateZ(Math.PI / 2);
        return g;
      };
      const rimGeo = (R, wdt) => {
        const parts = [{ geo: new THREE.CylinderGeometry(R * 0.62, R * 0.62, wdt * 0.92, 18, 1, true), matrix: M4(0, 0, 0, 0, 0, Math.PI / 2) }];
        for (const sx of [-1, 1]) {
          parts.push({ geo: new THREE.CircleGeometry(R * 0.6, 18), matrix: M4(sx * wdt * 0.42, 0, 0, 0, sx * Math.PI / 2, 0) });
          for (let k = 0; k < 5; k++) parts.push({ geo: new THREE.BoxGeometry(0.02, R * 1.1, 0.045), matrix: M4(sx * wdt * 0.44, 0, 0, (k / 5) * Math.PI * 2, 0, 0) });
        }
        return mergeGeos(parts);
      };
      const stripe = (R, wdt) => mergeGeos([
        { geo: new THREE.TorusGeometry(R * 0.78, 0.012, 4, 30), matrix: M4(-wdt / 2 - 0.002, 0, 0, 0, Math.PI / 2, 0) },
        { geo: new THREE.TorusGeometry(R * 0.78, 0.012, 4, 30), matrix: M4(wdt / 2 + 0.002, 0, 0, 0, Math.PI / 2, 0) }
      ]);
      const disc = new THREE.CylinderGeometry(0.17, 0.17, 0.05, 12); disc.rotateZ(Math.PI / 2);
      const wheelGeo = (R, wdt) => mergeColored([
        { geo: tyreGeo(R, wdt), color: linCol("#1c1c1e") },
        { geo: rimGeo(R, wdt), color: linCol("#3a3d42") },
        { geo: stripe(R, wdt), color: linCol("#ffd23f") }
      ]);
      const res = {
        wheel: wheelGeo(0.36, 0.36), wheelR: wheelGeo(0.37, 0.44), disc,
        swRim: mergeGeos([
          { geo: new THREE.TorusGeometry(0.125, 0.017, 6, 22, Math.PI * 1.25), matrix: M4(0, 0, 0, 0, 0, -Math.PI * 0.125) },
          { geo: new THREE.BoxGeometry(0.03, 0.08, 0.03), matrix: M4(-0.115, -0.06, 0) },
          { geo: new THREE.BoxGeometry(0.03, 0.08, 0.03), matrix: M4(0.115, -0.06, 0) }
        ]),
        swHub: new THREE.BoxGeometry(0.2, 0.09, 0.03),
        swScreen: new THREE.PlaneGeometry(0.075, 0.045),
        number: new THREE.PlaneGeometry(0.22, 0.16), side: new THREE.PlaneGeometry(1.0, 0.22),
        shadow: (() => { const g = new THREE.PlaneGeometry(2.4, 5.8); g.rotateX(-Math.PI / 2); return g; })()
      };
      for (const k of Object.keys(res)) disposables.push(res[k]);
      return res;
    })();
    const sharedMats = {
      carbon: new THREE.MeshStandardMaterial({ color: 0x17191d, roughness: 0.42, metalness: 0.35 }),
      wheel: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide }),
      screen: new THREE.MeshBasicMaterial({ color: 0x23c7ff, side: THREE.DoubleSide }),
      paint: new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.38, metalness: 0.05, clearcoat: 0.65, clearcoatRoughness: 0.12, envMapIntensity: 0.6 }),
      shadow: new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false })
    };
    for (const k of Object.keys(sharedMats)) disposables.push(sharedMats[k]);
    const liveryMats = new Map();
    function liveryMaterials(t) {
      if (liveryMats.has(t)) return liveryMats.get(t);
      const team = TEAMS[t];
      const num = new THREE.MeshBasicMaterial({ map: textTex(String(team.num), team.accent, team.trim, 64, 48), transparent: false });
      const side = new THREE.MeshBasicMaterial({ map: textTex(team.name.toUpperCase(), team.trim, team.accent, 256, 48, "bold 26px Inter, Arial, sans-serif") });
      const disc = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0xff3a00, emissiveIntensity: 0, roughness: 0.6 });
      const ms = { num, side, disc };
      for (const k of Object.keys(ms)) disposables.push(ms[k]);
      liveryMats.set(t, ms);
      return ms;
    }
    function buildCar(teamIdx, castShadow) {
      const m = liveryMaterials(teamIdx);
      const g = carGeo;
      const car = new THREE.Group();
      const body = new THREE.Group(); // pitches/rolls with suspension
      car.add(body);
      const detailed = !!castShadow;
      const add = (geo, mat, parent) => { const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = detailed; (parent || body).add(mesh); return mesh; };
      const pg = paintGeometry(teamIdx);
      add(pg.body, sharedMats.paint);
      const helmet = add(pg.helmet, sharedMats.paint);
      const num = add(g.number, m.num); num.position.set(0, 0.36, 2.72); num.rotation.x = -Math.PI / 2 + 0.2; num.rotation.z = Math.PI; num.castShadow = false;
      if (detailed) {
        const sL = add(g.side, m.side); sL.position.set(-0.885, 0.43, -0.25); sL.rotation.y = -Math.PI / 2; sL.castShadow = false;
        const sR = add(g.side, m.side); sR.position.set(0.885, 0.43, -0.25); sR.rotation.y = Math.PI / 2; sR.castShadow = false;
      }
      const wheels = [];
      const wheelPos = [[-0.86, 0.36, 1.62, false], [0.86, 0.36, 1.62, false], [-0.84, 0.37, -1.48, true], [0.84, 0.37, -1.48, true]];
      for (const [x, y, z, rear] of wheelPos) {
        const steerG = new THREE.Group(); steerG.position.set(x, y, z);
        const spin = new THREE.Group(); steerG.add(spin);
        const t = new THREE.Mesh(rear ? g.wheelR : g.wheel, sharedMats.wheel); t.castShadow = detailed;
        spin.add(t);
        if (detailed) { const d = new THREE.Mesh(g.disc, m.disc); d.position.x = x < 0 ? 0.24 : -0.24; steerG.add(d); }
        car.add(steerG);
        wheels.push({ steer: steerG, spin, rear });
      }
      const shadow = new THREE.Mesh(g.shadow, sharedMats.shadow);
      shadow.position.y = 0.03; shadow.renderOrder = 1;
      car.add(shadow);
      let wheelRim = null;
      if (detailed) {
        const mount = new THREE.Group();
        mount.position.set(0, 0.66, 0.6); mount.rotation.x = 0.5;
        wheelRim = new THREE.Group();
        wheelRim.add(new THREE.Mesh(g.swRim, sharedMats.carbon), new THREE.Mesh(g.swHub, sharedMats.carbon), new THREE.Mesh(g.swScreen, sharedMats.screen));
        mount.add(wheelRim);
        body.add(mount);
      }
      return { group: car, body, wheels, helmet, mats: m, wheelRim };
    }

    // Batch static scenery: merge meshes that share a material into one draw call
    function batchWorld() {
      world.updateMatrixWorld(true);
      const groups = new Map();
      world.traverse(o => {
        if (!o.isMesh || o.isInstancedMesh || o.userData.keep || Array.isArray(o.material)) return;
        const key = o.material.uuid + "|" + o.castShadow + "|" + o.receiveShadow + "|" + o.renderOrder;
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(o);
      });
      for (const list of groups.values()) {
        if (list.length < 2) continue;
        const geo = mergeGeos(list.map(m => ({ geo: m.geometry, matrix: m.matrixWorld })));
        const merged = new THREE.Mesh(geo, list[0].material);
        merged.castShadow = list[0].castShadow; merged.receiveShadow = list[0].receiveShadow; merged.renderOrder = list[0].renderOrder;
        for (const m of list) m.parent.remove(m);
        world.add(merged);
        disposables.push(geo);
      }
    }

    // =====================================================================
    // Cars (physics state + visuals)
    // =====================================================================
    const cars = [];
    function makeCarState(teamIdx, isPlayer, driver) {
      const vis = buildCar(teamIdx, isPlayer);
      scene.add(vis.group);
      return {
        team: teamIdx, isPlayer, name: driver, vis,
        x: 0, z: 0, h: 0, vx: 0, vz: 0, wr: 0, ax: 0, steer: 0, throttle: 0, brake: 0,
        u: 0, vlat: 0, slipF: 0, slipR: 0, onCurb: false, offTrack: false, surf: 0,
        idx: 0, s: 0, d: 0, progress: 0, lapsDone: -1, lapStart: 0, lastLap: null, bestLap: null,
        lapValid: true, finished: false, finishTime: null, finishOrder: 0, gear: 1, rpm: 0, wheelRot: 0,
        susp: 0, suspV: 0, pitch: 0, roll: 0, boost: 1, boosting: false, slip: 0,
        ai: null, holdTimer: 0, stuckTimer: 0, collideCooldown: 0, lastLapTimes: [], ry: 0, rs: 0, slope: 0
      };
    }
    const projTmp = { idx: 0, s: 0, d: 0 };

    // ---- time-trial ghost: the personal best lap on this circuit, replayed as a translucent car ----
    // Samples every GHOST_MS of lap time: [t ms, x dm, z dm, heading mrad, lap distance m].
    const GHOST_MS = 100;
    const ghost = { data: null, vis: null, visTeam: -1, rec: [], recT: 0, world: null };
    function ghostKey() { return "ghost_" + circuit.id; }
    function loadGhost() {
      ghost.data = null;
      try {
        const g = ctx.storage.get(ghostKey());
        if (g && typeof g.t === "number" && isFinite(g.t) && Array.isArray(g.p) && g.p.length >= 50 && g.p.length % 5 === 0) ghost.data = g;
      } catch (e) { /* storage optional */ }
    }
    function ghostVisual() {
      if (ghost.vis && ghost.visTeam === settings.livery) return ghost.vis;
      if (ghost.vis) scene.remove(ghost.vis.group);
      const v = buildCar(settings.livery, false);
      v.group.traverse(o => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.transparent = true; o.material.opacity = 0.32; o.material.depthWrite = false;
        o.castShadow = false; o.renderOrder = 3;
      });
      v.helmet.visible = true;
      scene.add(v.group);
      ghost.vis = v; ghost.visTeam = settings.livery;
      return v;
    }
    function recordGhostSample(car) {
      const t = raceTime - car.lapStart;
      if (t < ghost.recT) return;
      const d = car.progress - Math.max(0, car.lapsDone) * TLEN;
      ghost.rec.push(Math.round(t), Math.round(car.x * 10), Math.round(car.z * 10), Math.round(car.h * 1000), Math.round(d * 10) / 10);
      ghost.recT = t + GHOST_MS;
    }
    function ghostLapDone(lt, valid) {
      if (valid && ghost.rec.length >= 50 && (!ghost.data || lt < ghost.data.t)) {
        ghost.data = { t: Math.round(lt), p: ghost.rec, team: settings.livery };
        try { ctx.storage.set(ghostKey(), ghost.data); } catch (e) { /* storage optional */ }
      }
      ghost.rec = []; ghost.recT = 0;
    }
    // ghost time at a given lap distance (for the live delta)
    function ghostTimeAt(d) {
      const p = ghost.data.p, n = p.length / 5;
      let lo = 0, hi = n - 1;
      if (d <= p[4]) return p[0];
      if (d >= p[(n - 1) * 5 + 4]) return p[(n - 1) * 5];
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (p[m * 5 + 4] < d) lo = m; else hi = m; }
      const d0 = p[lo * 5 + 4], d1 = p[hi * 5 + 4];
      return lerp(p[lo * 5], p[hi * 5], d1 > d0 ? (d - d0) / (d1 - d0) : 0);
    }
    function updateGhost() {
      const show = raceMode === "tt" && settings.ghost && ghost.data && player && !player.finished && (state === "racing" || state === "countdown");
      if (!show) { if (ghost.vis) ghost.vis.group.visible = false; return; }
      const v = ghostVisual();
      const p = ghost.data.p, n = p.length / 5;
      const t = state === "countdown" ? 0 : raceTime - player.lapStart;
      if (t > p[(n - 1) * 5]) { v.group.visible = false; return; }
      let i = clamp(Math.floor(t / GHOST_MS), 0, n - 2);
      while (i > 0 && p[i * 5] > t) i--;
      while (i < n - 2 && p[(i + 1) * 5] < t) i++;
      const t0 = p[i * 5], t1 = p[(i + 1) * 5], f = t1 > t0 ? clamp((t - t0) / (t1 - t0), 0, 1) : 0;
      const a = i * 5, b = a + 5;
      const x = lerp(p[a + 1], p[b + 1], f) / 10, z = lerp(p[a + 2], p[b + 2], f) / 10;
      const h0 = p[a + 3] / 1000, h = h0 + wrapAngle(p[b + 3] / 1000 - h0) * f;
      const y = track.bridge ? sampleAt(lerp(p[a + 4], p[b + 4], f)).y : 0;
      v.group.visible = true;
      v.group.position.set(x, y, z);
      v.group.rotation.set(0, h, 0, "YXZ");
    }
    loadGhost();
    function fetchWorldBest() {
      ghost.world = null;
      try {
        const r = ctx.memory && ctx.memory.record && ctx.memory.record("best_lap").leaderboard({ scope: "global", period: "all_time", dimensions: { circuit: circuit.record }, limit: 1 });
        if (r && r.then) r.then(lb => {
          const row = lb && lb.rows && lb.rows[0];
          const v = row && (typeof row.value === "number" ? row.value : typeof row.score === "number" ? row.score : null);
          if (v != null && isFinite(v) && v > 0) ghost.world = v;
        }).catch(() => {});
      } catch (e) { /* leaderboard optional */ }
    }

    function placeCarAt(car, s, d) {
      const p = sampleAt(s);
      car.x = p.x + p.rx * d; car.z = p.z + p.rz * d;
      car.h = Math.atan2(p.fx, p.fz);
      car.vx = car.vz = car.wr = 0; car.ax = 0;
      project(car.x, car.z, p.i, projTmp, !track.bridge);
      car.idx = projTmp.idx; car.s = projTmp.s; car.d = projTmp.d;
      car.px = car.rx = car.x; car.pz = car.rz = car.z; car.ph = car.rh = car.h;
    }

    // ---------- vehicle dynamics (bicycle model, SAE frame: x fwd, y right) ----------
    function pacejka(alpha, D) {
      const B = 16, C = 1.22;
      return -D * Math.sin(C * Math.atan(B * alpha));
    }
    function stepCar(car, dt, ctrl) {
      const P = PHYS;
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      const rx = -fz, rz = fx;
      let u = car.vx * fx + car.vz * fz;
      let vl = car.vx * rx + car.vz * rz;
      const speed = Math.hypot(car.vx, car.vz);
      // surface
      project(car.x, car.z, car.idx, projTmp, false);
      car.idx = projTmp.idx; car.d = projTmp.d;
      const ds = projTmp.s - car.s;
      car.s = projTmp.s;
      let dsw = ds; if (dsw > TLEN / 2) dsw -= TLEN; if (dsw < -TLEN / 2) dsw += TLEN;
      car.progress += dsw;
      const ad = Math.abs(car.d);
      const curbHere = car.d < 0 ? track.curbL[car.idx] : track.curbR[car.idx];
      const gravelHere = car.d < 0 ? track.gravelL[car.idx] : track.gravelR[car.idx];
      let gripMul = 1, rollMul = 1;
      car.onCurb = false; car.offTrack = false; car.surf = 0;
      if (ad > W) {
        if (curbHere && ad <= W + CURB) { car.onCurb = true; gripMul = 0.93; car.surf = 1; }
        else if (!STREET && ad > W + 0.6) {
          car.offTrack = ad > W + CURB + 0.4;
          if (gravelHere) { gripMul = 0.5; rollMul = 26; car.surf = 3; } else { gripMul = 0.62; rollMul = 14; car.surf = 2; }
        }
      }
      const steerMax = lerp(P.steerMax, P.steerMinHigh, clamp(speed / 80, 0, 1));
      const delta = ctrl.steer * steerMax;
      // loads
      const down = P.kd * u * u;
      const Wt = P.mass * P.g;
      let Nf = Wt * P.b / P.L - P.mass * car.ax * P.hcg / P.L + down * 0.45;
      let Nr = Wt * P.a / P.L + P.mass * car.ax * P.hcg / P.L + down * 0.55;
      Nf = Math.max(Nf, 600); Nr = Math.max(Nr, 600);
      const mu = P.mu * gripMul * (ctrl.gripAssist || 1);
      // longitudinal
      let Fdrive = 0;
      const boostMul = ctrl.boost ? 1.14 : 1;
      if (ctrl.throttle > 0) {
        const fmax = P.power * boostMul / Math.max(Math.abs(u), 6);
        Fdrive = ctrl.throttle * Math.min(fmax, mu * Nr * 0.85);
        // traction control: keep enough rear grip in reserve for cornering, and cut power when the rear slides
        const tc = ctrl.tc || 0;
        if (tc) {
          const k = Math.max(0.3, lerp(0.8, 0.3, clamp((Math.abs(u) - 12) / 30, 0, 1)));
          Fdrive = Math.min(Fdrive, (tc === 2 ? 0.55 : 0.75) * mu * Nr / k);
          if (car.slipR > (tc === 2 ? 0.08 : 0.12)) Fdrive *= tc === 2 ? 0.4 : 0.65;
        }
      }
      let Fbrake = 0, reverse = 0;
      if (ctrl.brake > 0) {
        if (u > 0.8) Fbrake = ctrl.brake * P.brakeMu * mu * (Nf + Nr);
        else if (ctrl.reverse) reverse = ctrl.brake;
        else if (u > -0.8) { car.vx *= 0.8; car.vz *= 0.8; }
      }
      if (reverse > 0 && ctrl.throttle < 0.1) {
        Fdrive = -reverse * 4500 * (u > -6 ? 1 : 0);
      }
      let brakeF = Fbrake * 0.7, brakeR = Fbrake * 0.3;
      const assist = ctrl.brakeAssist || 0;   // 0 off, 1 medium, 2 full (player only)
      if (ctrl.abs && !assist && Fbrake > 0) {
        // basic ABS for the player at every assist level: the wheels never lock solid, a little steering always remains
        const maxF = 0.92 * mu * Nf, maxR = 0.8 * mu * Nr;
        if (brakeF > maxF || brakeR > maxR) { brakeF = Math.min(brakeF, maxF); brakeR = Math.min(brakeR, maxR); Fbrake = brakeF + brakeR; }
      }
      if (assist && Fbrake > 0) {
        // ABS-style assist: keep each axle below its lock point so part of its grip stays available
        // for steering (more when the player is turning); spill any front excess to the rear if it has room.
        const steerUse = clamp(Math.abs(ctrl.steer), 0, 1);
        const resF = assist === 2 ? 0.25 + 0.5 * steerUse : 0.25 + 0.3 * steerUse;
        const resR = assist === 2 ? 0.5 + 0.4 * steerUse : 0.5 + 0.3 * steerUse;   // rear stability first
        const maxF = Math.sqrt(1 - resF * resF) * mu * Nf, maxR = Math.sqrt(1 - resR * resR) * mu * Nr;
        const f = Math.min(brakeF, maxF);
        const spill = steerUse < 0.15 ? Math.max(0, brakeF - maxF) : 0;   // only in a straight line
        const r = Math.min(brakeR + spill, Math.max(maxR, Math.min(brakeR, maxR)));
        brakeF = f; brakeR = r; Fbrake = f + r;
      }
      // slip angles (low speed safe)
      const uu = Math.max(Math.abs(u), 4);
      const aF = Math.atan2(vl + P.a * car.wr, uu) - delta * Math.sign(u || 1);
      const aR = Math.atan2(vl - P.b * car.wr, uu);
      const capF = Math.sqrt(Math.max(0, (mu * Nf) ** 2 - brakeF * brakeF));
      const rearLong = Math.max(0, Fdrive) * lerp(0.8, 0.3, clamp((Math.abs(u) - 12) / 30, 0, 1)) + brakeR;
      const capR = Math.sqrt(Math.max(0, (mu * Nr) ** 2 - rearLong * rearLong)) * (ctrl.rearAssist || 1);
      // brake assist keeps the car's balance on the understeer side while braking (no snap spins)
      const capFa = (assist || ctrl.abs) && Fbrake > 0 ? Math.min(capF, capR * (P.b / P.a) * (assist === 2 ? 0.9 : 1.0)) : capF;
      let Fyf = pacejka(aF, capFa);
      let Fyr = pacejka(aR, capR);
      car.slipF = Math.abs(aF); car.slipR = Math.abs(aR);
      // longitudinal net force in body frame
      const drag = P.cd * u * Math.abs(u) * (ctrl.slip ? (1 - ctrl.slip) : 1);
      const rollF = P.roll * rollMul * Wt * Math.sign(u) * Math.min(1, Math.abs(u));
      const brakeSign = Math.sign(u);
      let Fx = Fdrive - Fbrake * brakeSign - Fyf * Math.sin(delta) - drag - rollF;
      let Fy = Fyf * Math.cos(delta) + Fyr;
      // low speed: blend lateral to kinematic to avoid jitter
      if (speed < 3) { Fy -= vl * P.mass * 4; }
      const torque = P.a * Fyf * Math.cos(delta) - P.b * Fyr;
      const axb = Fx / P.mass, ayb = Fy / P.mass;
      car.ax = damp(car.ax, axb, 10, dt);
      // integrate (world frame)
      car.vx += (axb * fx + ayb * rx) * dt;
      car.vz += (axb * fz + ayb * rz) * dt;
      car.wr += (torque / P.iz) * dt;
      // brake assist: calm oversteer while braking (yaw beyond what the steering asks for)
      if ((assist || ctrl.abs) && Fbrake > 0 && speed > 8) {
        // target = requested yaw rate, limited to what the tyres can sustain at this speed
        const cap = mu * (Nf + Nr) / (P.mass * Math.max(u, 5));
        const want = clamp(u * Math.tan(delta) / P.L, -cap, cap);
        const over = car.wr - want;
        if (Math.abs(car.wr) > Math.abs(want) && Math.sign(over) === Math.sign(car.wr || 1)) car.wr -= over * clamp(dt * (assist === 2 ? 7 : assist ? 3.5 : 2), 0, 1);
      }
      // stability: yaw damping when nearly stopped
      if (speed < 4) {
        const target = u * Math.tan(delta) / P.L;
        car.wr = lerp(car.wr, target, clamp(dt * 8, 0, 1));
      }
      // prevent brake from reversing direction
      const nu = car.vx * fx + car.vz * fz;
      if (Fbrake > 0 && u > 0 && nu < 0) { car.vx -= nu * fx; car.vz -= nu * fz; }
      car.x += car.vx * dt;
      car.z += car.vz * dt;
      car.h -= car.wr * dt;
      car.u = car.vx * Math.sin(car.h) + car.vz * Math.cos(car.h);
      car.vlat = vl;
      car.throttle = ctrl.throttle; car.brake = ctrl.brake; car.steer = ctrl.steer;
      car.slip = Math.max(0, Math.max(car.slipR, car.slipF * 0.8) - 0.09) * (speed > 6 ? 1 : 0);
      // gear / rpm
      const as = Math.abs(car.u);
      let gear = 1;
      while (gear < 8 && as > GEARS[gear]) gear++;
      car.gearChanged = gear !== car.gear;
      car.gear = gear;
      const lo = GEARS[gear - 1], hi = GEARS[gear];
      const span = Math.min(hi, 92) - lo;
      car.rpm = clamp(4800 + 7200 * (as - lo) / span + (ctrl.throttle > 0 && as < 2 ? 3000 * ctrl.throttle : 0), 3800, 12400);
    }

    // barrier collision + track-limit bookkeeping
    function barrierCollide(car) {
      let hit = 0;
      for (const sgn of [1, -1]) {
        const fx = Math.sin(car.h), fz = Math.cos(car.h);
        const cx = car.x + fx * CAR_OFF * sgn, cz = car.z + fz * CAR_OFF * sgn;
        project(cx, cz, car.idx, projTmp, false);
        const i = projTmp.idx;
        const lim = (projTmp.d < 0 ? track.limL[i] : track.limR[i]) - CAR_R;
        const ad = Math.abs(projTmp.d);
        if (ad > lim) {
          const pen = ad - lim;
          const nx = -track.RX[i] * Math.sign(projTmp.d), nz = -track.RZ[i] * Math.sign(projTmp.d); // inward normal
          car.x += nx * pen; car.z += nz * pen;
          const vn = car.vx * nx + car.vz * nz;
          if (vn < 0) {
            const e = 0.22;
            car.vx -= (1 + e) * vn * nx; car.vz -= (1 + e) * vn * nz;
            // scrub tangential speed
            const scrub = clamp(0.06 + Math.abs(vn) * 0.02, 0, 0.45);
            car.vx *= 1 - scrub; car.vz *= 1 - scrub;
            // yaw response: align toward track tangent
            const tx = track.FX[i], tz = track.FZ[i];
            const th = Math.atan2(tx, tz);
            const err = wrapAngle(th - car.h);
            if (Math.abs(err) < Math.PI / 2) car.h += err * clamp(Math.abs(vn) * 0.02, 0.02, 0.25);
            car.wr *= 0.6;
            hit = Math.max(hit, Math.abs(vn));
          }
        }
      }
      return hit;
    }

    // cars on the bridge and cars passing beneath it never touch
    const sameLevel = (a, b) => Math.abs(track.Y[a.idx] - track.Y[b.idx]) < 3;
    function carCollisions(onHit) {
      const n = cars.length;
      for (let a = 0; a < n; a++) {
        const A = cars[a];
        for (let b = a + 1; b < n; b++) {
          const B = cars[b];
          const dx0 = B.x - A.x, dz0 = B.z - A.z;
          if (dx0 * dx0 + dz0 * dz0 > 64 || !sameLevel(A, B)) continue;
          const afx = Math.sin(A.h), afz = Math.cos(A.h), bfx = Math.sin(B.h), bfz = Math.cos(B.h);
          for (const sa of [1, -1]) for (const sb of [1, -1]) {
            const ax = A.x + afx * CAR_OFF * sa, az = A.z + afz * CAR_OFF * sa;
            const bx = B.x + bfx * CAR_OFF * sb, bz = B.z + bfz * CAR_OFF * sb;
            const dx = bx - ax, dz = bz - az;
            const dist = Math.hypot(dx, dz);
            const minD = CAR_R * 2;
            if (dist >= minD || dist < 1e-4) continue;
            const nx = dx / dist, nz = dz / dist;
            const pen = minD - dist;
            A.x -= nx * pen * 0.5; A.z -= nz * pen * 0.5;
            B.x += nx * pen * 0.5; B.z += nz * pen * 0.5;
            const rvx = B.vx - A.vx, rvz = B.vz - A.vz;
            const vn = rvx * nx + rvz * nz;
            if (vn < 0) {
              const e = 0.25;
              const j = -(1 + e) * vn / 2;
              A.vx -= j * nx; A.vz -= j * nz;
              B.vx += j * nx; B.vz += j * nz;
              // modest yaw kick from off-centre contact
              const cpx = (ax + bx) / 2, cpz = (az + bz) / 2;
              const ra = (cpx - A.x) * (-nz) - (cpz - A.z) * (-nx);
              const rb = (cpx - B.x) * (nz) - (cpz - B.z) * (nx);
              A.wr += clamp(ra * j * 0.05, -0.8, 0.8);
              B.wr += clamp(rb * j * 0.05, -0.8, 0.8);
              if (onHit) onHit(A, B, Math.abs(vn));
            }
          }
        }
      }
    }

    // ---------- AI driver ----------
    const DIFF = { easy: 0.82, medium: 0.89, hard: 0.945 };
    const PLAYER_ASSIST = { easy: 1.07, medium: 1.035, hard: 1.0 };
    function aiControl(car, dt, raceOn) {
      const ai = car.ai;
      const ctrl = ai.ctrl;
      if (!raceOn) { ctrl.throttle = 0; ctrl.brake = 1; ctrl.steer = 0; return ctrl; }
      const speed = Math.max(0, car.u);
      // decision tick
      ai.think -= dt;
      if (ai.think <= 0) {
        ai.think = 0.1 + rand() * 0.05;
        let ahead = null, aheadGap = 1e9;
        let behindClose = null;
        for (const o of cars) {
          if (o === car) continue;
          let gap = o.progress - car.progress;
          if (gap > 0 && gap < 32) {
            const latDiff = Math.abs(o.d - car.d);
            if (latDiff < 2.6 && gap < aheadGap) { ahead = o; aheadGap = gap; }
          }
          if (gap < 0 && gap > -12) behindClose = o;
        }
        ai.ahead = ahead; ai.aheadGap = aheadGap;
        const lineOff = racing.off[car.idx];
        const brakingSoon = racing.v[(car.idx + 30) % TN] < speed - 12;
        if (ahead && ahead.u < ai.lastTarget - 0.5 && aheadGap < 26 && !brakingSoon && rand() < ai.aggr) {
          // choose overtaking side with more room
          const roomL = ahead.d + W, roomR = W - ahead.d;
          const side = roomR > roomL ? 1 : -1;
          ai.laneTarget = clamp(ahead.d + side * 3.4, -(W - 1.3), W - 1.3) - lineOff;
          ai.passing = 1.4;
        } else if (ai.passing > 0) {
          ai.passing -= 0.1;
        } else if (behindClose && rand() < ai.defend) {
          // light defence: cover the inside of the next corner (never swerve into a car)
          const kAhead = track.K[(car.idx + 30) % TN];
          const inside = kAhead > 0 ? 1 : kAhead < 0 ? -1 : 0;
          const want = clamp(inside * 2.2, -(W - 1.3), W - 1.3) - lineOff;
          const occupied = Math.abs(behindClose.d - (lineOff + want)) < 2.2 && behindClose.progress > car.progress - 6;
          ai.laneTarget = occupied ? ai.laneTarget : want * 0.6;
        } else {
          ai.laneTarget = ai.bias;
        }
      }
      ai.lane = damp(ai.lane, ai.laneTarget, 1.2, dt);
      // pure-pursuit target point
      const look = STREET ? 5 + speed * 0.3 : 7 + speed * 0.42;   // shorter look-ahead so street-circuit AI cannot cut into walls
      const tIdx = (car.idx + Math.round(look / TDS)) % TN;
      const off = clamp(racing.off[tIdx] + ai.lane, -(W - 1.1), W - 1.1);
      const tx = track.X[tIdx] + track.RX[tIdx] * off, tz = track.Z[tIdx] + track.RZ[tIdx] * off;
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      const dx = tx - car.x, dz = tz - car.z;
      const latErr = dx * (-fz) + dz * fx;  // right-positive
      const lonErr = dx * fx + dz * fz;
      const alpha = Math.atan2(latErr, Math.max(lonErr, 1));
      const L = PHYS.L;
      let steerAngle = Math.atan(2 * L * Math.sin(alpha) / Math.max(look, 4));
      const steerMax = lerp(PHYS.steerMax, PHYS.steerMinHigh, clamp(speed / 80, 0, 1));
      // yaw-rate damping for stability
      const wrDes = speed * Math.tan(steerAngle) / L;
      steerAngle += (wrDes - car.wr) * 0.035;
      ctrl.steer = clamp(steerAngle / steerMax, -1, 1);
      // speed target
      const pIdx = (car.idx + Math.round(Math.max(4, speed * 0.25) / TDS)) % TN;
      let target = racing.v[pIdx] * ai.skill * ai.cornerVar[Math.floor(pIdx / 60) % ai.cornerVar.length];
      // look further ahead for braking (min over a window)
      for (let k = 1; k < 40; k += 3) {
        const j = (car.idx + k * 2) % TN;
        const dist = k * 2 * TDS;
        const vj = racing.v[j] * ai.skill;
        const brakeCap = 0.78 * PHYS.brakeMu * PHYS.mu * (PHYS.g + PHYS.kd * vj * vj / PHYS.mass);
        target = Math.min(target, Math.sqrt(vj * vj + 2 * brakeCap * dist));
      }
      if (ai.ahead) {
        // keep a speed-dependent following gap; a passing car only backs off when about to touch
        const want = ai.passing > 0 ? 5 : 5 + speed * 0.32;
        if (ai.aheadGap < want) target = Math.min(target, ai.ahead.u + (ai.aheadGap - want) * 0.7);
        if (ai.ahead.brake > 0.3 && ai.aheadGap < want * 1.5 && ai.passing <= 0) target = Math.min(target, ai.ahead.u);
      }
      if (car.offTrack) target = Math.min(target, 30);
      target *= 1 - 0.012 * Math.min(6, Math.abs(ai.lane));
      ai.lastTarget = target;
      const err = target - speed;
      if (err > 0.5) { ctrl.throttle = clamp(err * 0.35, 0.2, 1); ctrl.brake = 0; }
      else if (err < -0.6) {
        ctrl.throttle = 0; ctrl.brake = clamp(-err * 0.4, 0.25, 1);
        // brake in a straight line; ease off once turning in
        if (Math.abs(ctrl.steer) > 0.35 && speed > 15) ctrl.brake = Math.min(ctrl.brake, 0.45);
      }
      else { ctrl.throttle = 0.3; ctrl.brake = 0; }
      // traction care: lift if rear slides
      if (car.slipR > 0.16) ctrl.throttle *= 0.4;
      // spun / facing wrong way recovery
      const th = Math.atan2(track.FX[car.idx], track.FZ[car.idx]);
      const headingErr = wrapAngle(th - car.h);
      if (Math.abs(headingErr) > 1.4) {
        ctrl.throttle = speed < 4 ? 0.5 : 0; ctrl.brake = speed > 4 ? 1 : 0;
        ctrl.steer = clamp(-headingErr, -1, 1);
      }
      // pinned against a wall: back out, steering away, then drive on
      const nearWall = Math.abs(car.d) > (car.d < 0 ? track.limL[car.idx] : track.limR[car.idx]) - 3;
      if ((car.stuckTimer > 0.7 && (nearWall || Math.abs(headingErr) > 0.9)) || ai.reverseT > 0) {
        if (!(ai.reverseT > 0)) ai.reverseT = 1.1;
        ai.reverseT -= dt;
        ctrl.throttle = 0; ctrl.brake = 1; ctrl.reverse = true;
        ctrl.steer = clamp(headingErr * 2 + Math.sign(car.d) * 0.6, -1, 1);
      } else ctrl.reverse = false;
      return ctrl;
    }

    // =====================================================================
    // Audio (procedural Web Audio)
    // =====================================================================
    const audio = {
      ac: null, master: null, engine: null, ready: false,
      init() {
        if (this.ac || !ctx.capabilities || ctx.capabilities.audio === false) return;
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          const ac = new AC();
          this.ac = ac;
          const master = ac.createGain(); master.gain.value = settings.sound ? settings.volume : 0;
          const comp = ac.createDynamicsCompressor();
          master.connect(comp); comp.connect(ac.destination);
          this.master = master;
          // noise buffer
          const nb = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
          const nd = nb.getChannelData(0);
          for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
          this.noiseBuf = nb;
          const noise = () => { const s = ac.createBufferSource(); s.buffer = nb; s.loop = true; s.start(); return s; };
          // engine: detuned saws + square sub through filter + shaper
          const eGain = ac.createGain(); eGain.gain.value = 0;
          const filt = ac.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 1200; filt.Q.value = 2.5;
          const shaper = ac.createWaveShaper();
          const curve = new Float32Array(512);
          for (let i = 0; i < 512; i++) { const x = i / 256 - 1; curve[i] = Math.tanh(x * 2.2); }
          shaper.curve = curve;
          const o1 = ac.createOscillator(); o1.type = "sawtooth";
          const o2 = ac.createOscillator(); o2.type = "sawtooth"; o2.detune.value = 9;
          const o3 = ac.createOscillator(); o3.type = "square";
          const g3 = ac.createGain(); g3.gain.value = 0.45;
          const o4 = ac.createOscillator(); o4.type = "triangle";
          const g4 = ac.createGain(); g4.gain.value = 0.25;
          o1.connect(shaper); o2.connect(shaper); o3.connect(g3); g3.connect(shaper); o4.connect(g4); g4.connect(shaper);
          shaper.connect(filt); filt.connect(eGain); eGain.connect(master);
          [o1, o2, o3, o4].forEach(o => o.start());
          this.engine = { o1, o2, o3, o4, filt, gain: eGain };
          // rival engine bed
          const rG = ac.createGain(); rG.gain.value = 0;
          const rF = ac.createBiquadFilter(); rF.type = "lowpass"; rF.frequency.value = 900;
          const r1 = ac.createOscillator(); r1.type = "sawtooth";
          r1.connect(rF); rF.connect(rG); rG.connect(master); r1.start();
          this.rival = { osc: r1, gain: rG };
          // tyre squeal
          const sq = noise(); const sqF = ac.createBiquadFilter(); sqF.type = "bandpass"; sqF.frequency.value = 2100; sqF.Q.value = 9;
          const sqG = ac.createGain(); sqG.gain.value = 0; sq.connect(sqF); sqF.connect(sqG); sqG.connect(master);
          this.squeal = { gain: sqG, filt: sqF };
          // wind
          const wn = noise(); const wF = ac.createBiquadFilter(); wF.type = "lowpass"; wF.frequency.value = 700;
          const wG = ac.createGain(); wG.gain.value = 0; wn.connect(wF); wF.connect(wG); wG.connect(master);
          this.wind = { gain: wG, filt: wF };
          // rumble (curbs/gravel)
          const rb = noise(); const rbF = ac.createBiquadFilter(); rbF.type = "lowpass"; rbF.frequency.value = 220;
          const rbG = ac.createGain(); rbG.gain.value = 0; rb.connect(rbF); rbF.connect(rbG); rbG.connect(master);
          const lfo = ac.createOscillator(); lfo.frequency.value = 22; const lfoG = ac.createGain(); lfoG.gain.value = 0;
          lfo.connect(lfoG); lfoG.connect(rbG.gain); lfo.start();
          this.rumble = { gain: rbG, lfo, lfoG, filt: rbF };
          // crowd
          const cr = noise(); const cF = ac.createBiquadFilter(); cF.type = "bandpass"; cF.frequency.value = 900; cF.Q.value = 0.6;
          const cG = ac.createGain(); cG.gain.value = 0; cr.connect(cF); cF.connect(cG); cG.connect(master);
          this.crowd = { gain: cG };
          this.ready = true;
        } catch (e) {
          ctx.platform.error({ stage: "audio", message: String(e && e.message || e) });
        }
      },
      resume() { if (this.ac && this.ac.state === "suspended") this.ac.resume().catch(() => {}); },
      suspend() { if (this.ac && this.ac.state === "running") this.ac.suspend().catch(() => {}); },
      setVolume() { if (this.master) this.master.gain.setTargetAtTime(settings.sound ? settings.volume : 0, this.ac.currentTime, 0.05); },
      silence() {
        if (!this.ready) return;
        const t = this.ac.currentTime;
        for (const n of [this.engine.gain, this.rival.gain, this.squeal.gain, this.wind.gain, this.rumble.gain, this.crowd.gain]) n.gain.setTargetAtTime(0, t, 0.05);
        this.rumble.lfoG.gain.setTargetAtTime(0, t, 0.05);
      },
      update(p, rivalInfo, crowdAmt) {
        if (!this.ready) return;
        const t = this.ac.currentTime;
        const rpm = p.rpm;
        const f = rpm / 60 * 1.5;
        const e = this.engine;
        e.o1.frequency.setTargetAtTime(f, t, 0.03);
        e.o2.frequency.setTargetAtTime(f * 1.005, t, 0.03);
        e.o3.frequency.setTargetAtTime(f * 0.5, t, 0.03);
        e.o4.frequency.setTargetAtTime(f * 2, t, 0.03);
        e.filt.frequency.setTargetAtTime(600 + p.throttle * 2600 + rpm * 0.12, t, 0.05);
        e.gain.gain.setTargetAtTime(0.07 + p.throttle * 0.11 + (rpm / 12400) * 0.04, t, 0.05);
        const speed = Math.abs(p.u);
        this.wind.gain.gain.setTargetAtTime(Math.min(0.22, speed * speed * 0.00003), t, 0.1);
        this.wind.filt.frequency.setTargetAtTime(400 + speed * 12, t, 0.1);
        const sq = clamp((p.slip - 0.02) * 2.2, 0, 0.32) * (p.surf >= 2 ? 0.2 : 1);
        this.squeal.gain.gain.setTargetAtTime(sq, t, 0.04);
        this.squeal.filt.frequency.setTargetAtTime(1800 + speed * 6, t, 0.1);
        const rum = p.onCurb ? 0.35 : p.surf >= 2 ? Math.min(0.3, speed * 0.01) : 0;
        this.rumble.gain.gain.setTargetAtTime(rum * 0.5, t, 0.03);
        this.rumble.lfoG.gain.setTargetAtTime(rum * 0.5, t, 0.03);
        this.rumble.lfo.frequency.setTargetAtTime(8 + speed * 0.5, t, 0.05);
        this.rumble.filt.frequency.setTargetAtTime(p.surf === 3 ? 600 : 220, t, 0.05);
        if (rivalInfo) {
          this.rival.osc.frequency.setTargetAtTime(rivalInfo.f, t, 0.06);
          this.rival.gain.gain.setTargetAtTime(rivalInfo.g, t, 0.08);
        }
        this.crowd.gain.gain.setTargetAtTime(crowdAmt * 0.05, t, 0.3);
      },
      blip(freq, dur, type, gain, when) {
        if (!this.ready) return;
        const ac = this.ac, t = ac.currentTime + (when || 0);
        const o = ac.createOscillator(); o.type = type || "sine"; o.frequency.value = freq;
        const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain || 0.3, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
      },
      thud(strength) {
        if (!this.ready) return;
        const ac = this.ac, t = ac.currentTime;
        const s = ac.createBufferSource(); s.buffer = this.noiseBuf;
        const f = ac.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500 + strength * 80;
        const g = ac.createGain(); const amp = clamp(strength / 18, 0.08, 0.9);
        g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18 + amp * 0.3);
        s.connect(f); f.connect(g); g.connect(this.master); s.start(t); s.stop(t + 0.6);
        this.blip(70, 0.25, "sine", amp * 0.8);
      },
      shift() {
        if (!this.ready) return;
        const e = this.engine, t = this.ac.currentTime;
        e.gain.gain.cancelScheduledValues(t);
        e.gain.gain.setValueAtTime(e.gain.gain.value * 0.35, t);
        this.blip(1400, 0.04, "square", 0.05);
      },
      fanfare() {
        const notes = [523, 659, 784, 1046, 784, 1046];
        notes.forEach((n, i) => this.blip(n, 0.28, "triangle", 0.22, i * 0.13));
      }
    };
    ctx.onDestroy(() => { try { if (audio.ac) audio.ac.close(); } catch (e) { /* ignore */ } });

    const haptic = (kind) => { if (settings.vibration) { try { ctx.platform.haptic(kind); } catch (e) { /* ignore */ } } };

    // =====================================================================
    // Tyre smoke particles (pooled)
    // =====================================================================
    const smoke = (() => {
      const N = 48;
      const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, opacity: 0.5 });
      disposables.push(mat);
      const pool = [];
      for (let i = 0; i < N; i++) { const s = new THREE.Sprite(mat.clone()); s.visible = false; scene.add(s); pool.push({ s, life: 0, vx: 0, vz: 0 }); disposables.push(s.material); }
      let next = 0;
      return {
        emit(x, z, vx, vz, y) {
          const p = pool[next]; next = (next + 1) % N;
          p.life = 1; p.s.visible = true; p.s.position.set(x + rrange(-0.3, 0.3), 0.4 + (y || 0), z + rrange(-0.3, 0.3));
          p.vx = vx * 0.2 + rrange(-1, 1); p.vz = vz * 0.2 + rrange(-1, 1); p.s.scale.setScalar(1);
        },
        update(dt) {
          for (const p of pool) {
            if (p.life <= 0) continue;
            p.life -= dt * 0.9;
            if (p.life <= 0) { p.s.visible = false; continue; }
            p.s.position.x += p.vx * dt; p.s.position.z += p.vz * dt; p.s.position.y += dt * 0.9;
            p.s.scale.setScalar(1 + (1 - p.life) * 4);
            p.s.material.opacity = p.life * 0.45;
          }
        },
        clear() { for (const p of pool) { p.life = 0; p.s.visible = false; } }
      };
    })();

    // =====================================================================
    // HUD + Menus (DOM)
    // =====================================================================
    const hud = el("div", "fr-screen fr-hide");
    hud.innerHTML = `
      <div class="fr-view">
      <div class="fr-vignette" style="position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(ellipse at 50% 55%,rgba(0,0,0,0) 55%,rgba(0,0,0,.55) 100%)"></div>
      <div style="position:absolute;left:var(--pl);top:var(--pt);display:flex;gap:.5em;align-items:flex-start">
        <button class="fr-btn fr-pause" aria-label="Pause" style="width:2.6em;height:2.6em;font-size:1em">❚❚</button>
        <div class="fr-panel" style="padding:.25em .7em;text-align:left">
          <div class="fr-lap-label" style="font-size:.7em;opacity:.7;letter-spacing:.12em">LAP</div>
          <div class="fr-lap" style="font-size:1.6em;line-height:1">1/3</div>
        </div>
        <div class="fr-panel" style="padding:.25em .7em;text-align:left">
          <div class="fr-pos-label" style="font-size:.7em;opacity:.7;letter-spacing:.12em">POS</div>
          <div class="fr-pos" style="font-size:1.6em;line-height:1">P1/8</div>
        </div>
      </div>
      <div class="fr-topc" style="position:absolute;left:50%;top:var(--pt);transform:translateX(-50%);text-align:center">
        <div class="fr-panel fr-timer-box" style="padding:.15em .9em">
          <div class="fr-timer" style="font-size:1.5em;letter-spacing:.06em">0:00.000</div>
          <div class="fr-delta fr-ui" style="font-size:.66em;font-weight:700;min-height:1.1em"></div>
        </div>
        <div class="fr-lights fr-hide" style="display:flex;gap:.5em;justify-content:center;margin-top:.5em;padding:.45em .7em;background:rgba(0,0,0,.65);border-radius:10px">
          <div class="fr-light"></div><div class="fr-light"></div><div class="fr-light"></div><div class="fr-light"></div><div class="fr-light"></div>
        </div>
        <div class="fr-warn fr-ui fr-hide" style="margin-top:.4em;font-size:.72em;font-weight:800;letter-spacing:.08em;padding:.3em .7em;border-radius:6px;background:rgba(255,196,0,.92);color:#111"></div>
      </div>
      <div class="fr-lb fr-panel" style="position:absolute;right:var(--pr);top:var(--pt);padding:.3em .25em;min-width:8.5em"></div>
      <svg class="fr-map" viewBox="0 0 100 100" style="position:absolute;left:var(--pl);top:calc(var(--pt) + 3.6em);width:7.5em;height:7.5em;opacity:.9;pointer-events:none"></svg>
      <div class="fr-cluster" style="position:absolute;left:var(--pl);bottom:var(--pb)">
        <div class="fr-panel" style="padding:.35em .8em .45em;min-width:8.2em">
          <div style="display:flex;align-items:baseline;gap:.4em">
            <div class="fr-speed" style="font-size:2.6em;line-height:.95">0</div>
            <div style="font-size:.75em;opacity:.7">KM/H</div>
            <div style="margin-left:auto;text-align:center"><div style="font-size:.55em;opacity:.6">GEAR</div><div class="fr-gear" style="font-size:1.7em;line-height:.9;color:#ffcf2e">N</div></div>
          </div>
          <div style="height:.42em;margin-top:.25em;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden"><div class="fr-rpm" style="height:100%;width:0;background:linear-gradient(90deg,#2ee678 0%,#2ee678 60%,#ffcf2e 78%,#ff2a3d 92%)"></div></div>
          <div style="display:flex;align-items:center;gap:.35em;margin-top:.3em"><div style="font-size:.55em;opacity:.65;letter-spacing:.1em">ERS</div><div style="flex:1;height:.3em;background:rgba(255,255,255,.12);border-radius:2px;overflow:hidden"><div class="fr-ers" style="height:100%;width:100%;background:#36c8ff"></div></div></div>
        </div>
      </div>
      <div class="fr-prox-l" style="position:absolute;left:31%;top:58%;font-size:2.2em;color:#ffcf2e;opacity:0;transition:opacity .15s;text-shadow:0 0 8px #000">❮</div>
      <div class="fr-prox-r" style="position:absolute;right:31%;top:58%;font-size:2.2em;color:#ffcf2e;opacity:0;transition:opacity .15s;text-shadow:0 0 8px #000">❯</div>
      <div class="fr-banner" style="opacity:0"></div>
      <div class="fr-wrong fr-hide fr-pulse" style="position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);font-size:2.4em;letter-spacing:.1em;padding:.15em .6em;border-radius:10px;background:rgba(255,196,0,.92);color:#111;white-space:nowrap;pointer-events:none">⚠️ WRONG WAY</div>
      <div class="fr-hint fr-ui fr-hide" style="position:absolute;left:50%;top:36%;transform:translateX(-50%);text-align:center;font-size:.8em;line-height:1.6;padding:.6em 1em;background:rgba(0,0,0,.55);border-radius:10px;max-width:70%"></div>
      </div>
      <div class="fr-deck"><div class="fr-deck-row fr-hud-deckrow"></div><div class="fr-hud-deckmap" style="display:flex;justify-content:center"></div></div>
      <div class="fr-ctl">
      <div class="fr-steer fr-hide">
        <div class="fr-pedal fr-left" style="width:4.4em;height:4.4em;border-radius:50%;font-size:1.25em">◀</div>
        <div class="fr-pedal fr-right" style="width:4.4em;height:4.4em;border-radius:50%;font-size:1.25em">▶</div>
      </div>
      <div class="fr-pedal fr-brake" style="width:4.6em;height:5.6em"><span>BRAKE</span></div>
      <div class="fr-pedal fr-gas" style="width:5.4em;height:7.4em"><span>GAS</span></div>
      <div class="fr-small fr-boost" style="font-size:.85em">ERS</div>
      <div class="fr-small fr-cam" role="button" aria-label="Switch view"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2.5" y="7" width="13" height="10" rx="2"/><path d="M15.5 10.5l6-3.5v10l-6-3.5z"/></svg><span class="fr-cam-label">CHASE</span></div>
      <div class="fr-small fr-reset" aria-label="Reset car">↺</div>
      <div class="fr-small fr-cam fr-steermode" role="button" aria-label="Switch steering"><span class="fr-steer-label">TILT</span></div>
      </div>
    `;
    const $ = (sel, scope) => (scope || stage).querySelector(sel);
    const H = {
      lap: $(".fr-lap", hud), lapLabel: $(".fr-lap-label", hud), pos: $(".fr-pos", hud), timer: $(".fr-timer", hud), delta: $(".fr-delta", hud),
      lights: $(".fr-lights", hud), warn: $(".fr-warn", hud), lb: $(".fr-lb", hud), map: $(".fr-map", hud),
      speed: $(".fr-speed", hud), gear: $(".fr-gear", hud), rpm: $(".fr-rpm", hud), ers: $(".fr-ers", hud),
      cluster: $(".fr-cluster", hud), steerBox: $(".fr-steer", hud), left: $(".fr-left", hud), right: $(".fr-right", hud),
      brake: $(".fr-brake", hud), gas: $(".fr-gas", hud), boost: $(".fr-boost", hud), cam: $(".fr-cam", hud), reset: $(".fr-reset", hud),
      pause: $(".fr-pause", hud), banner: $(".fr-banner", hud), hint: $(".fr-hint", hud), proxL: $(".fr-prox-l", hud), proxR: $(".fr-prox-r", hud),
      vignette: $(".fr-vignette", hud), camLabel: $(".fr-cam-label", hud), ctl: $(".fr-ctl", hud),
      posLabel: $(".fr-pos-label", hud), steerMode: $(".fr-steermode", hud), steerLabel: $(".fr-steer-label", hud), wrong: $(".fr-wrong", hud)
    };
    docks.push([H.cluster, H.cluster.parentNode, $(".fr-hud-deckrow", hud)]);
    docks.push([$(".fr-topc", hud), $(".fr-topc", hud).parentNode, $(".fr-hud-deckrow", hud)]);
    docks.push([H.lb, H.lb.parentNode, $(".fr-hud-deckrow", hud)]);
    docks.push([H.map, H.map.parentNode, $(".fr-hud-deckmap", hud)]);
    const lightEls = Array.from(H.lights.querySelectorAll(".fr-light"));

    // minimap
    function buildMinimap() {
      let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
      for (let i = 0; i < TN; i++) { minX = Math.min(minX, track.X[i]); maxX = Math.max(maxX, track.X[i]); minZ = Math.min(minZ, track.Z[i]); maxZ = Math.max(maxZ, track.Z[i]); }
      const sc = 92 / Math.max(maxX - minX, maxZ - minZ);
      const ox = (100 - (maxX - minX) * sc) / 2, oz = (100 - (maxZ - minZ) * sc) / 2;
      const mx = x => ox + (x - minX) * sc, mz = z => oz + (z - minZ) * sc;
      let d = "";
      for (let i = 0; i < TN; i += 4) d += (i ? "L" : "M") + mx(track.X[i]).toFixed(1) + " " + mz(track.Z[i]).toFixed(1);
      d += "Z";
      H.map.innerHTML = `<path d="${d}" fill="none" stroke="rgba(0,0,0,.55)" stroke-width="5" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="2.2" stroke-linejoin="round"/>` +
        `<rect x="${mx(track.X[0]) - 2.5}" y="${mz(track.Z[0]) - 0.8}" width="5" height="1.6" fill="#ff2a3d"/><g class="fr-dots"></g>`;
      return { mx, mz, dots: H.map.querySelector(".fr-dots"), els: [] };
    }
    let mapState = buildMinimap();

    function layoutHud() {
      // Touch controls live in stage space: over the bottom of the view in landscape,
      // inside the control deck in portrait. Sizes scale with the control font size.
      const em = parseFloat(stage.style.fontSize) || 16;
      const ce = portrait ? clamp(SW / 26, 13, 18) : em;
      H.ctl.style.fontSize = ce + "px";
      const pr = Math.max(12, safe.right + 10), pl = Math.max(12, safe.left + 10);
      const pb = Math.max(12, safe.bottom + (portrait ? 14 : 10));
      const pt = Math.max(10, safe.top + 8);
      const touch = effectiveSteering() === "touch";
      H.gas.style.right = pr + "px"; H.gas.style.bottom = pb + "px";
      if (touch) {
        // Button steering: GAS and BRAKE both on the right thumb, steering arrows on the left
        H.brake.style.left = "auto"; H.brake.style.right = (pr + 6.8 * ce) + "px";
        H.brake.style.width = "4.6em"; H.brake.style.height = "5.6em";
      } else {
        // Tilt steering: BRAKE under the left thumb, GAS under the right thumb
        H.brake.style.right = "auto"; H.brake.style.left = pl + "px";
        H.brake.style.width = "5.4em"; H.brake.style.height = "7.4em";
      }
      H.brake.style.bottom = pb + "px";
      H.boost.style.right = (pr + 1.4 * ce) + "px"; H.boost.style.bottom = (pb + 8.1 * ce) + "px";
      if (portrait) {
        H.cam.style.top = "auto"; H.reset.style.top = "auto";
        H.cam.style.right = (pr + 6.8 * ce) + "px"; H.cam.style.bottom = (pb + 6.4 * ce) + "px";
        H.reset.style.right = (pr + 4.1 * ce) + "px"; H.reset.style.bottom = (pb + 8.1 * ce) + "px";
      } else {
        const lbW = H.lb.offsetWidth || 9 * em;
        H.cam.style.bottom = "auto"; H.reset.style.bottom = "auto";
        H.cam.style.top = pt + "px"; H.cam.style.right = (pr + lbW + 0.6 * em) + "px";
        const camW = H.cam.offsetWidth || 6 * ce;
        H.reset.style.top = pt + "px"; H.reset.style.right = (pr + lbW + camW + 1.1 * em) + "px";
        // steering switch sits under the view button (the top row is full)
        const camH = H.cam.offsetHeight || 2.6 * ce;
        H.steerMode.style.bottom = "auto"; H.steerMode.style.top = (pt + camH + 0.45 * em) + "px"; H.steerMode.style.right = (pr + lbW + 0.6 * em) + "px";
      }
      H.steerLabel.textContent = settings.steering === "motion" ? "TILT" : "BUTTONS";
      H.steerBox.classList.toggle("fr-hide", !touch);
      const bs = 4.4 * 1.25 * ce;
      if (touch) {
        H.left.style.left = pl + "px"; H.left.style.bottom = pb + "px";
        H.right.style.left = (pl + bs + 1.1 * ce) + "px"; H.right.style.bottom = pb + "px";
      }
      if (!portrait) {
        // tilt mode: the speed cluster sits beside the left-thumb BRAKE so it never covers the minimap
        H.cluster.style.bottom = (touch ? pb + bs + 0.6 * em : pb) + "px";
        H.cluster.style.left = touch ? "var(--pl)" : (pl + 6.3 * ce) + "px";
      }
    }
    layoutListeners.push(layoutHud);

    // ---- generic screens ----
    const menu = el("div", "fr-screen fr-hide");
    menu.innerHTML = `
      <div class="fr-view">
      <div style="position:absolute;inset:0;background:linear-gradient(90deg,rgba(5,7,12,.88) 0%,rgba(5,7,12,.55) 34%,rgba(5,7,12,0) 60%)"></div>
      <div class="fr-menu-panel" style="position:absolute;left:calc(var(--pl) + 1em);top:50%;transform:translateY(-50%);width:16em">
        <div style="font-size:.8em;letter-spacing:.35em;color:#ff2a3d">GRAND PRIX</div>
        <div style="font-size:3.4em;line-height:.9;letter-spacing:.04em">FORMULA<br>RUSH</div>
        <div class="fr-ui fr-menu-sub" style="font-size:.7em;opacity:.65;margin:.5em 0 .8em">Aurora Ring · 2.5 km · Original circuit</div>
        <div style="display:flex;gap:.4em"><button class="fr-menu-btn primary fr-play" style="white-space:nowrap;padding-left:.7em;padding-right:.4em">PLAY RACE</button><button class="fr-menu-btn fr-tt" style="white-space:nowrap;padding-left:.7em;padding-right:.4em;border-left-color:#36c8ff">TIME TRIAL</button></div>
        <button class="fr-menu-btn fr-circuits">CIRCUIT</button>
        <button class="fr-menu-btn fr-cars">CAR SELECTION</button>
        <button class="fr-menu-btn fr-settings">SETTINGS</button>
      </div>
      <div class="fr-ui fr-menu-team" style="position:absolute;right:var(--pr);bottom:var(--pb);text-align:right;font-size:.8em;opacity:.85"></div>
      </div>
      <div class="fr-deck"><div class="fr-menu-deck"></div><div class="fr-ui" style="font-size:.75em;opacity:.6;margin-top:auto;text-align:center">Turn your phone sideways for full-screen racing</div></div>
    `;
    docks.push([$(".fr-menu-panel", menu), $(".fr-menu-panel", menu).parentNode, $(".fr-menu-deck", menu)]);
    const carSel = el("div", "fr-screen fr-hide");
    carSel.innerHTML = `
      <div class="fr-view">
      <div style="position:absolute;inset:0;background:linear-gradient(270deg,rgba(5,7,12,.9) 0%,rgba(5,7,12,.6) 30%,rgba(5,7,12,0) 55%)"></div>
      <div style="position:absolute;left:var(--pl);top:var(--pt);display:flex;gap:.6em;align-items:center">
        <button class="fr-btn fr-back" style="padding:.4em .8em;font-size:.9em">◀ BACK</button>
        <div style="font-size:1.6em;letter-spacing:.08em">CAR SELECTION</div>
      </div>
      <div class="fr-ui" style="position:absolute;left:var(--pl);bottom:var(--pb);font-size:.72em;opacity:.7">Drag the car to rotate</div>
      <div class="fr-cars-col" style="position:absolute;right:var(--pr);top:var(--pt);bottom:var(--pb);width:15em;display:flex;flex-direction:column">
        <div class="fr-scroll fr-liveries" style="flex:1;min-height:0;padding-right:.2em"></div>
        <button class="fr-menu-btn primary fr-start" style="text-align:center;margin-top:.5em">START RACE ▶</button>
      </div>
      </div>
      <div class="fr-deck"><div class="fr-cars-deck" style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div>
    `;
    docks.push([$(".fr-cars-col", carSel), $(".fr-cars-col", carSel).parentNode, $(".fr-cars-deck", carSel)]);
    // ---- circuit selection ----
    const circSel = el("div", "fr-screen fr-hide");
    circSel.innerHTML = `
      <div class="fr-view">
      <div style="position:absolute;inset:0;background:rgba(5,7,12,.72)"></div>
      <div style="position:absolute;left:var(--pl);top:var(--pt);display:flex;gap:.6em;align-items:center">
        <button class="fr-btn fr-cback" style="padding:.4em .8em;font-size:.9em">◀ BACK</button>
        <div style="font-size:1.6em;letter-spacing:.08em">SELECT CIRCUIT</div>
      </div>
      <div class="fr-circ-col" style="position:absolute;left:var(--pl);right:var(--pr);top:calc(var(--pt) + 3.4em);bottom:var(--pb);display:flex;flex-direction:column">
        <div class="fr-circ-cards" style="flex:1;min-height:0;display:flex;gap:.8em"></div>
        <button class="fr-menu-btn primary fr-cstart" style="text-align:center;margin-top:.6em">START RACE ▶</button>
      </div>
      </div>
      <div class="fr-deck"><div class="fr-circ-deck" style="flex:1;min-height:0;display:flex;flex-direction:column"></div></div>
    `;
    docks.push([$(".fr-circ-col", circSel), $(".fr-circ-col", circSel).parentNode, $(".fr-circ-deck", circSel)]);
    function circuitPreview(def) {
      const pts = catmullRom(def.ctrl, 6);
      let a = 1e9, b = -1e9, c = 1e9, d = -1e9;
      for (const p of pts) { a = Math.min(a, p[0]); b = Math.max(b, p[0]); c = Math.min(c, p[1]); d = Math.max(d, p[1]); }
      const sc = Math.min(88 / (b - a), 52 / (d - c));
      const ox = (100 - (b - a) * sc) / 2, oy = (60 - (d - c) * sc) / 2;
      let path = "";
      pts.forEach((p, i) => { path += (i ? "L" : "M") + (ox + (p[0] - a) * sc).toFixed(1) + " " + (oy + (d - p[1]) * sc).toFixed(1); });
      const bg = def.night ? "#070b18" : def.street ? "#3b3326" : "#1f3a24";
      const line = def.night ? "#7fd0ff" : "#ffffff";
      const sfx = (ox + (def.sf[0] - a) * sc).toFixed(1), sfy = (oy + (d - def.sf[1]) * sc).toFixed(1);
      return `<svg viewBox="0 0 100 60" style="width:100%;height:100%;display:block;background:${bg};border-radius:6px">` +
        (def.night ? `<path d="${path}Z" fill="none" stroke="#2a6fff" stroke-width="5" opacity=".35"/>` : "") +
        `<path d="${path}Z" fill="none" stroke="rgba(0,0,0,.5)" stroke-width="3.6" stroke-linejoin="round"/><path d="${path}Z" fill="none" stroke="${line}" stroke-width="1.6" stroke-linejoin="round"/>` +
        `<circle cx="${sfx}" cy="${sfy}" r="2.2" fill="#ff2a3d"/></svg>`;
    }
    function renderCircuits() {
      const box = $(".fr-circ-cards", circSel);
      box.innerHTML = "";
      for (const def of Object.values(CIRCUITS)) {
        const c = document.createElement("div");
        c.className = "fr-card" + (def.id === settings.circuit ? " sel" : "");
        c.style.cssText = "flex:1;min-width:0;flex-direction:column;align-items:stretch;gap:.4em;margin:0;padding:.5em";
        c.innerHTML = `<div style="flex:1;min-height:3em">${circuitPreview(def)}</div>
          <div style="font-family:'Bebas Neue',Inter,sans-serif;font-size:1.12em;letter-spacing:.02em;font-weight:400;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${def.name.toUpperCase()}</div>
          <div style="opacity:.6;font-weight:400;font-size:.8em">${def.night ? '<span style="color:#7fd0ff;opacity:1">NIGHT</span> · ' : ""}${def.length} · ${def.blurb}</div>`;
        box.appendChild(c);
        ctx.input.activate(c, () => {
          if (settings.circuit === def.id) return;
          settings.circuit = def.id; saveSettings();
          loadCircuit(def.id);
          renderCircuits();
          ctx.platform.interact({ type: "circuit", circuit: def.id });
        });
      }
    }
    function updateCircuitTexts() {
      $(".fr-menu-sub", menu).textContent = `${circuit.name} · ${circuit.length} · ${circuit.id === "aurora" ? "Original circuit" : circuit.street ? "Street circuit" : "Grand prix circuit"}`;
      $(".fr-pre-round", preRace).textContent = `ROUND 1 · ${circuit.name.toUpperCase()}`;
    }
    const modal = el("div", "fr-screen fr-hide");
    modal.style.pointerEvents = "auto";
    modal.style.background = "rgba(3,5,10,.72)";
    modal.innerHTML = `<div class="fr-modal-body fr-panel" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(30em,86%);max-height:86%;display:flex;flex-direction:column;padding:.8em 1em"></div>`;
    const modalBody = $(".fr-modal-body", modal);
    const preRace = el("div", "fr-screen fr-hide");
    preRace.innerHTML = `
      <div class="fr-view">
      <div style="position:absolute;left:0;right:0;bottom:0;height:45%;background:linear-gradient(0deg,rgba(0,0,0,.7),rgba(0,0,0,0))"></div>
      <div style="position:absolute;left:calc(var(--pl) + .5em);bottom:calc(var(--pb) + .4em)">
        <div class="fr-pre-round" style="font-size:.8em;letter-spacing:.3em;color:#ff2a3d">ROUND 1 · AURORA RING</div>
        <div class="fr-pre-title" style="font-size:2.4em;line-height:1"></div>
        <div class="fr-pre-sub fr-ui" style="font-size:.75em;opacity:.8;margin-top:.3em"></div>
      </div>
      <div class="fr-ui fr-pre-skip" style="position:absolute;right:var(--pr);bottom:var(--pb);font-size:.75em;opacity:.75">Tap to skip ▸</div>
      </div>
      <div class="fr-deck"><div class="fr-ui" style="margin:auto;text-align:center;font-size:.8em;opacity:.7;line-height:1.7">Turn your phone sideways for full-screen racing<br>Tap anywhere to skip</div></div>
    `;
    const toast = el("div", "fr-ui fr-hide", "");
    toast.style.cssText = "position:absolute;left:50%;top:calc(var(--vy) + var(--vh) * 0.18);transform:translateX(-50%);background:rgba(0,0,0,.78);padding:.5em .9em;border-radius:8px;font-size:.78em;pointer-events:none;max-width:80%;text-align:center";
    // Landscape is the intended presentation. When the host keeps the device in portrait (no
    // orientation lock available) we ask the player to rotate, and offer the compact portrait layout only on request.
    const rotateEl = el("div", "fr-screen fr-hide");
    rotateEl.style.cssText += ";pointer-events:auto;background:radial-gradient(ellipse at 50% 45%,#1d2433,#06080d 72%);z-index:20";
    rotateEl.innerHTML = `
      <div style="position:absolute;left:50%;top:46%;transform:translate(-50%,-50%);text-align:center;width:86%">
        <svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round" style="opacity:.9"><rect x="20" y="8" width="24" height="44" rx="4"/><path d="M8 40a24 24 0 0 0 24 18" stroke="#ff2a3d"/><path d="M27 58l5 0 0-5" stroke="#ff2a3d"/></svg>
        <div style="font-size:2em;letter-spacing:.08em;margin-top:.4em">ROTATE TO <span class="fr-accent">LANDSCAPE</span></div>
        <div class="fr-ui" style="font-size:.85em;opacity:.7;margin-top:.5em;line-height:1.5">Formula Rush is a landscape racing game.<br>Turn your phone sideways to race full screen.</div>
        <button class="fr-btn fr-ui fr-portrait-ok" style="margin:1.4em auto 0;padding:.6em 1.2em;font-size:.8em">Continue in portrait</button>
      </div>`;
    let portraitOk = false;
    function updateRotatePrompt() { rotateEl.classList.toggle("fr-hide", !portrait || portraitOk); }
    ctx.input.activate(rotateEl.querySelector(".fr-portrait-ok"), () => { portraitOk = true; updateRotatePrompt(); });
    layoutListeners.push(updateRotatePrompt);
    function requestLandscape() {
      try { const so = screen.orientation; if (so && so.lock) so.lock("landscape").catch(() => {}); } catch (e) { /* not supported by this host */ }
    }
    let toastT = 0;
    function showToast(msg, sec) { toast.textContent = msg; toast.classList.remove("fr-hide"); toastT = sec || 2.6; }

    // =====================================================================
    // Game state
    // =====================================================================
    let state = "loading"; // menu, carSelect, preRace, countdown, racing, finished, results
    let paused = false;
    let raceTime = 0;           // ms since lights out
    let countdownT = 0, lightsLit = 0, lightsOutAt = 0;
    let preRaceT = 0;
    let player = null;
    let camMode = settings.view;
    let finishedT = 0;
    let finishCount = 0;
    let wrongDist = 0, wrongLast = null;   // metres driven against the race direction
    let penaltyMs = 0, trackLimitWarnings = 0, offTrackTimer = 0;
    let resetHold = 0;
    let lastWarnText = "";
    let attempt = 0;
    let motionActive = false, motionFallback = false;
    let motionNeutral = null, motionNoDataT = 0;
    let lastMotionAt = 0;
    let menuOrbit = 0, carSelYaw = 0.6, carSelDrag = null;
    let rivalEngineInfo = null;
    const input = { gas: 0, brake: 0, left: 0, right: 0, boost: 0, keySteer: 0 };
    let steerSmoothed = 0, reverseHold = 0;

    function effectiveSteering() { return (settings.steering === "motion" && !motionFallback) ? "motion" : "touch"; }
    // quick switch between tilt and button steering (HUD and pause menu)
    function toggleSteering() {
      settings.steering = settings.steering === "motion" ? "touch" : "motion"; saveSettings();
      motionFallback = false;
      releaseAll();
      if (settings.steering === "motion") { motionNeutral = null; startMotion(); } else motionActive = false;
      layoutHud();
      showToast(settings.steering === "motion" ? "Tilt steering · turn the phone like a wheel" : "Button steering", 2);
      ctx.platform.interact({ type: "steering", mode: settings.steering });
    }

    // ---- input wiring ----
    // Hold-to-press controls. Each button tracks its own pointer ids, so releasing one finger never
    // cancels another finger's control. A window-level release guard prevents stuck inputs if a
    // pointer ends outside the button without capture.
    const holdReleasers = [];
    function holdButton(elm, key) {
      const ids = new Set();
      const set = () => { input[key] = ids.size > 0 ? 1 : 0; elm.classList.toggle("on", ids.size > 0); };
      const release = id => { if (ids.delete(id)) set(); };
      ctx.listen(elm, "pointerdown", e => {
        e.preventDefault();
        if (ids.has(e.pointerId)) return;
        ids.add(e.pointerId);
        try { elm.setPointerCapture(e.pointerId); } catch (er) { /* capture optional */ }
        set();
        audio.resume();
        if (key === "gas" || key === "brake") ctx.platform.interact({ type: key });
      });
      ctx.listen(elm, "pointerup", e => release(e.pointerId));
      ctx.listen(elm, "pointercancel", e => release(e.pointerId));
      ctx.listen(elm, "lostpointercapture", e => release(e.pointerId));
      ctx.listen(elm, "pointerleave", e => {
        let captured = false;
        try { captured = elm.hasPointerCapture(e.pointerId); } catch (er) { /* ignore */ }
        if (!captured) release(e.pointerId);
      });
      ctx.listen(elm, "contextmenu", e => e.preventDefault());
      holdReleasers.push(release);
      return () => { ids.clear(); set(); };
    }
    ctx.listen(window, "pointerup", e => { for (const r of holdReleasers) r(e.pointerId); });
    ctx.listen(window, "pointercancel", e => { for (const r of holdReleasers) r(e.pointerId); });
    const releasers = [
      holdButton(H.gas, "gas"), holdButton(H.brake, "brake"), holdButton(H.left, "left"),
      holdButton(H.right, "right"), holdButton(H.boost, "boost")
    ];
    const releaseAll = () => { releasers.forEach(r => r()); input.keySteer = 0; keys.clear(); if (typeof resetControls === "function") resetControls(); };
    const keys = new Set();
    ctx.listen(window, "keydown", e => {
      const k = e.key;
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "w", "a", "s", "d"].includes(k)) e.preventDefault && e.preventDefault();
      keys.add(k.toLowerCase());
      if ((k === "c" || k === "C") && !e.repeat) toggleCam();
      if (k === "Escape" || k === "p" || k === "P") { if (state === "racing" || state === "countdown") togglePause(!paused); }
      if (k === "r" || k === "R") requestReset();
      audio.resume();
    });
    ctx.listen(window, "keyup", e => keys.delete(e.key.toLowerCase()));
    ctx.listen(window, "blur", () => releaseAll());
    ctx.listen(document, "visibilitychange", () => {
      if (document.hidden) { releaseAll(); if (state === "racing" || state === "countdown") togglePause(true); audio.suspend(); }
    });

    // In-race buttons fire on pointerdown: a second finger never produces a click while the first
    // finger holds the throttle, so click-only buttons would ignore taps during acceleration.
    function pressButton(elm, fn) {
      let lastPress = -1e9;
      ctx.listen(elm, "pointerdown", e => { e.preventDefault(); e.stopPropagation(); lastPress = performance.now(); fn(); });
      ctx.listen(elm, "contextmenu", e => e.preventDefault());
      ctx.input.activate(elm, () => { if (performance.now() - lastPress > 600) fn(); });   // keyboard / click fallback
    }
    pressButton(H.cam, () => toggleCam());
    pressButton(H.reset, () => requestReset());
    pressButton(H.steerMode, () => toggleSteering());
    pressButton(H.pause, () => togglePause(true));

    // ---- menu wiring ----
    const tap = (elm, fn) => ctx.input.activate(elm, () => { audio.init(); audio.resume(); ctx.platform.interact({ type: "ui" }); fn(); });
    tap($(".fr-play", menu), () => startRaceFlow(false, "race"));
    tap($(".fr-tt", menu), () => openTimeTrial());
    tap($(".fr-cars", menu), () => setState("carSelect"));
    tap($(".fr-circuits", menu), () => setState("circuitSelect"));
    tap($(".fr-cback", circSel), () => setState("menu"));
    tap($(".fr-cstart", circSel), () => startRaceFlow(false, "race"));
    tap($(".fr-settings", menu), () => openSettings(false));
    tap($(".fr-back", carSel), () => setState("menu"));
    tap($(".fr-start", carSel), () => startRaceFlow(false, "race"));

    function renderLiveries() {
      const box = $(".fr-liveries", carSel);
      box.innerHTML = "";
      TEAMS.forEach((t, i) => {
        const c = document.createElement("div");
        c.className = "fr-card" + (i === settings.livery ? " sel" : "");
        c.innerHTML = `<div class="fr-sw" style="background:linear-gradient(90deg,${t.body} 0 60%,${t.accent} 60% 85%,${t.trim} 85%)"></div><div style="flex:1"><div>${t.name}</div><div style="opacity:.55;font-weight:400;font-size:.85em">#${t.num} · ${t.code}</div></div>`;
        box.appendChild(c);
        ctx.input.activate(c, () => {
          settings.livery = i; saveSettings();
          renderLiveries(); refreshShowcase();
          ctx.platform.interact({ type: "livery", team: t.code });
        });
      });
    }
    // Showcase car for menus
    let showcase = null;
    function refreshShowcase() {
      if (showcase) { scene.remove(showcase.group); }
      showcase = buildCar(settings.livery, true);
      scene.add(showcase.group);
      placeShowcase();
      const t = TEAMS[settings.livery];
      $(".fr-menu-team", menu).innerHTML = `<div style="font-family:'Bebas Neue',Inter,sans-serif;font-size:1.6em;letter-spacing:.06em">${t.name}</div><div style="opacity:.7">Car #${t.num}</div>`;
    }
    // Swap the loaded circuit (menus only): dispose the old scenery, rebuild track data, racing line,
    // scenery, lighting and minimap. Race state is created fresh by setupRace() when the race starts.
    function loadCircuit(id) {
      const def = CIRCUITS[id];
      if (!def || def === circuit) return;
      const shared = new Set([asphaltTex, grassTex, gravelTex, curbTex, wallTex, fenceTex, checkerTex, rubberTex, crowdTex, cityTex, windowTex, windowLitTex, blobTex, smokeTex]);
      scene.remove(world);
      world.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
            for (const t of [m.map, m.emissiveMap]) if (t && !shared.has(t)) t.dispose();
            m.dispose();
          }
        }
      });
      loadCircuitData(def);
      loadGhost();
      buildWorld(def);
      guide.mesh.visible = false;
      mapState = buildMinimap();
      if (showcase) placeShowcase();
      updateCircuitTexts();
    }
    function placeShowcase() {
      const sl = GRID_SLOT(0);
      const p = sampleAt(sl.s + 6);
      showcase.group.position.set(p.x, p.y, p.z);
      showcase.group.rotation.y = Math.atan2(p.fx, p.fz);
      showcase.base = { x: p.x, z: p.z, h: Math.atan2(p.fx, p.fz) };
    }
    // drag to rotate (car selection)
    const stageDragX = e => rotated === -90 ? -e.clientY : rotated === 90 ? e.clientY : e.clientX;
    ctx.listen(canvas, "pointerdown", e => { if (state === "carSelect") { carSelDrag = { x: stageDragX(e), yaw: carSelYaw }; } });
    ctx.listen(canvas, "pointermove", e => {
      if (state === "carSelect" && carSelDrag) {
        const dx = stageDragX(e) - carSelDrag.x;
        carSelYaw = carSelDrag.yaw + dx * 0.012;
      }
    });
    ctx.listen(canvas, "pointerup", () => { carSelDrag = null; });
    ctx.listen(canvas, "pointercancel", () => { carSelDrag = null; });
    // pre-race skip
    ctx.listen(preRace, "pointerdown", () => { if (state === "preRace") preRaceT = 99; });
    preRace.style.pointerEvents = "auto";

    // ---- settings modal ----
    function openSettings(fromPause) {
      const segs = [
        ["Brake assist", "brakeAssist", [["off", "Off"], ["medium", "Medium"], ["full", "Full"], ["auto", "Auto"]]],
        ["Traction control", "tc", [["off", "Off"], ["medium", "Medium"], ["full", "Full"]]],
        ["Difficulty", "difficulty", [["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]]],
        ["Laps", "laps", [[3, "3"], [5, "5"], [10, "10"]]],
        ["Grid size", "grid", [[6, "6"], [8, "8"], [10, "10"]]],
        ["Racing line", "racingLine", [[true, "On"], [false, "Off"]]],
        ["Time trial laps", "ttLaps", [[1, "1"], [3, "3"], [5, "5"], [10, "10"]]],
        ["Ghost car (time trial)", "ghost", [[true, "On"], [false, "Off"]]],
        ["Controls", "steering", [["motion", "Tilt steering"], ["touch", "Button steering"]]],
        ["Tilt sensitivity", "sensitivity", [[0.7, "Low"], [1, "Mid"], [1.4, "High"]]],
        ["Tilt dead zone", "deadzone", [[0.015, "Small"], [0.03, "Mid"], [0.07, "Large"]]],
        ["Invert tilt", "invertTilt", [[false, "Off"], [true, "On"]]],
        ["View", "view", [[0, "Chase"], [1, "Cockpit"]]],
        ["Sound", "sound", [[true, "On"], [false, "Off"]]],
        ["Volume", "volume", [[0.4, "Low"], [0.8, "Mid"], [1, "High"]]],
        ["Vibration", "vibration", [[true, "On"], [false, "Off"]]],
        ["Graphics", "quality", [["high", "High"], ["low", "Low"]]],
        ["Sideways screen", "screenSide", [["left", "Top left"], ["right", "Top right"]]]
      ];
      const locked = fromPause ? new Set(["laps", "grid", "difficulty"]) : new Set();
      modalBody.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.3em"><div style="font-size:1.5em;letter-spacing:.08em">SETTINGS</div><button class="fr-btn fr-close" style="padding:.35em .9em;font-size:.9em">DONE</button></div><div class="fr-scroll fr-ui fr-set-list" style="flex:1;min-height:0;padding-right:.3em"></div>`;
      const list = $(".fr-set-list", modalBody);
      for (const [label, key, opts] of segs) {
        const row = document.createElement("div");
        row.className = "fr-row";
        row.innerHTML = `<div style="font-size:.8em;${locked.has(key) ? "opacity:.45" : ""}">${label}${locked.has(key) ? " <span style='font-size:.8em'>(next race)</span>" : ""}</div><div class="fr-seg"></div>`;
        const seg = row.querySelector(".fr-seg");
        for (const [val, txt] of opts) {
          const b = document.createElement("button");
          b.textContent = txt;
          if (settings[key] === val) b.classList.add("sel");
          seg.appendChild(b);
          bindAct(b, () => {
            settings[key] = val; saveSettings();
            for (const x of seg.children) x.classList.remove("sel");
            b.classList.add("sel");
            if (key === "view") setCamMode(val, false);
            if (key === "sound" || key === "volume") { audio.init(); audio.setVolume(); }
            if (key === "racingLine") guide.mesh.visible = !!val;
            if (key === "steering") { motionFallback = false; if (val === "motion" && fromPause) startMotion(); layoutHud(); }
            if (key === "screenSide") layout();
            if (key === "brakeAssist") updateAssistLabels();
            if (key === "quality") { renderer.shadowMap.enabled = val === "high"; scene.traverse(o => { if (o.material) o.material.needsUpdate = true; }); applyRendererSize(); }
          });
        }
        list.appendChild(row);
      }
      if (fromPause) {
        const row = document.createElement("div");
        row.className = "fr-row";
        row.innerHTML = `<div style="font-size:.8em">Tilt calibration</div><div class="fr-seg"><button>Recalibrate</button></div>`;
        bindAct(row.querySelector("button"), () => { motionNeutral = null; showToast("Hold the phone level — calibrating", 1.5); });
        list.appendChild(row);
      }
      bindAct($(".fr-close", modalBody), () => { if (fromPause) openPauseMenu(); else closeModal(); });
      modal.classList.remove("fr-hide");
    }
    // Modal and results content is rebuilt on every open; one delegated listener per container
    // dispatches to the button's handler so reopening never stacks new listener registrations.
    function bindAct(elm, fn) { if (elm) elm.__frAct = fn; }
    const delegate = e => { const b = e.target.closest("button"); if (b && b.__frAct) { audio.resume(); b.__frAct(); } };
    ctx.listen(modalBody, "click", delegate);
    function closeModal() { modal.classList.add("fr-hide"); }
    const ASSIST_NAMES = { off: "OFF", medium: "MEDIUM", full: "FULL", auto: "AUTO" };
    function updateAssistLabels() {
      const b = $(".fr-passist", modalBody);
      if (b) b.textContent = "BRAKES: " + ASSIST_NAMES[settings.brakeAssist];
      const st = $(".fr-psteer", modalBody), tc = $(".fr-ptc", modalBody);
      if (st) st.textContent = "STEER: " + (settings.steering === "motion" ? "TILT" : "BUTTONS");
      if (tc) tc.textContent = "TC: " + ({ off: "OFF", medium: "MEDIUM", full: "FULL" })[settings.tc];
    }
    function openTimeTrial() {
      loadGhost();
      const render = () => {
        const seg = (key, opts) => opts.map(([v, t]) => `<button data-k="${key}" data-v="${v}" class="${settings[key] === v ? "sel" : ""}">${t}</button>`).join("");
        modalBody.innerHTML = `
          <div style="font-size:1.6em;letter-spacing:.08em">TIME TRIAL</div>
          <div class="fr-ui" style="font-size:.75em;opacity:.7;margin:.1em 0 .5em">${circuit.name} · solo against the clock${ghost.data ? ` · ghost ${fmtTime(ghost.data.t)}` : " · your best lap becomes your ghost"}</div>
          <div class="fr-ui">
            <div class="fr-row"><div style="font-size:.8em">Laps</div><div class="fr-seg">${seg("ttLaps", [[1, "1"], [3, "3"], [5, "5"], [10, "10"]])}</div></div>
            <div class="fr-row"><div style="font-size:.8em">Ghost car</div><div class="fr-seg">${seg("ghost", [[true, "On"], [false, "Off"]])}</div></div>
          </div>
          <div style="display:flex;gap:.6em;margin-top:.6em">
            <button class="fr-menu-btn fr-ttback" style="text-align:center">BACK</button>
            <button class="fr-menu-btn primary fr-ttgo" style="text-align:center">START</button>
          </div>`;
        for (const b of modalBody.querySelectorAll("button[data-k]")) {
          bindAct(b, () => {
            const k = b.dataset.k, raw = b.dataset.v;
            settings[k] = k === "ghost" ? raw === "true" : Number(raw); saveSettings(); render();
          });
        }
        bindAct($(".fr-ttback", modalBody), () => closeModal());
        bindAct($(".fr-ttgo", modalBody), () => { closeModal(); startRaceFlow(false, "tt"); });
      };
      render();
      modal.classList.remove("fr-hide");
    }
    function openPauseMenu() {
      // two-column grid so every option (MAIN MENU included) fits on a short landscape screen
      modalBody.innerHTML = `
        <div style="font-size:1.7em;letter-spacing:.1em;text-align:center;margin:0 0 .2em">PAUSED</div>
        <div class="fr-scroll fr-pause-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0 .6em;font-size:.82em">
          <button class="fr-menu-btn primary fr-resume" style="text-align:center;grid-column:1 / span 2">RESUME</button>
          <button class="fr-menu-btn fr-quit" style="text-align:center">MAIN MENU</button>
          <button class="fr-menu-btn fr-restart" style="text-align:center">RESTART</button>
          <button class="fr-menu-btn fr-psteer" style="text-align:center"></button>
          <button class="fr-menu-btn fr-passist" style="text-align:center"></button>
          <button class="fr-menu-btn fr-ptc" style="text-align:center"></button>
          <button class="fr-menu-btn fr-psettings" style="text-align:center">SETTINGS</button>
        </div>`;
      bindAct($(".fr-resume", modalBody), () => togglePause(false));
      bindAct($(".fr-restart", modalBody), () => { closeModal(); paused = false; startRaceFlow(true); });
      bindAct($(".fr-psettings", modalBody), () => openSettings(true));
      bindAct($(".fr-passist", modalBody), () => {
        const order = ["off", "medium", "full", "auto"];
        settings.brakeAssist = order[(order.indexOf(settings.brakeAssist) + 1) % order.length]; saveSettings();
        updateAssistLabels();
      });
      bindAct($(".fr-psteer", modalBody), () => { toggleSteering(); updateAssistLabels(); });
      bindAct($(".fr-ptc", modalBody), () => {
        const order = ["off", "medium", "full"];
        settings.tc = order[(order.indexOf(settings.tc) + 1) % order.length]; saveSettings();
        updateAssistLabels();
      });
      updateAssistLabels();
      bindAct($(".fr-quit", modalBody), () => { closeModal(); paused = false; audio.silence(); setState("menu"); });
      modal.classList.remove("fr-hide");
    }
    function togglePause(on) {
      if (!(state === "racing" || state === "countdown" || state === "finished")) return;
      if (on === paused) return;
      paused = on;
      releaseAll();
      if (paused) { audio.silence(); openPauseMenu(); }
      else { closeModal(); audio.resume(); }
    }

    // ---- motion steering ----
    async function startMotion() {
      if (settings.steering !== "motion") return;
      if (!ctx.capabilities || !ctx.capabilities.motion || !ctx.motion) {
        motionFallback = true; layoutHud();
        showToast("Tilt steering isn't available here — using touch steering", 3);
        return;
      }
      try {
        await ctx.motion.start();
        motionActive = true; motionFallback = false; motionNoDataT = 0;
      } catch (e) {
        motionFallback = true;
        showToast("Motion permission denied — using touch steering", 3);
      }
      layoutHud();
    }
    const tilt = { filt: 0, lastAt: null, age: 0 };
    function readTilt(dt) {
      // Steering in [-1,1] (positive = right) from the gravity angle in the screen plane, relative to
      // the neutral captured at the start lights. Works in any device orientation.
      if (!motionActive || !ctx.motion) return null;
      const snap = ctx.motion.snapshot;
      if (!snap) return null;
      if (snap.source === "none") {
        motionNoDataT += dt;
        if (motionNoDataT > 3 && !motionFallback) {
          motionFallback = true; layoutHud();
          showToast("No tilt data — switched to touch steering", 3);
        }
        return null;
      }
      motionNoDataT = 0;
      const at = snap.atMs || 0;
      if (at !== tilt.lastAt) { tilt.lastAt = at; tilt.age = 0; } else tilt.age += dt;
      if (tilt.age > 1) {
        // sensor stream interrupted: ease back to neutral instead of holding the last angle
        tilt.filt = approach(tilt.filt, 0, 2.5 * dt);
        return tilt.filt;
      }
      let raw;
      const g1 = snap.gravity, g2 = snap.accelerationIncludingGravity;
      let gx = 0, gy = 0;
      if (g1 && Math.hypot(g1.x || 0, g1.y || 0) > 2) { gx = g1.x; gy = g1.y; }
      else if (g2 && Math.hypot(g2.x || 0, g2.y || 0) > 2) { gx = g2.x; gy = g2.y; }
      if (gx || gy) {
        const ang = Math.atan2(gy, gx);
        if (motionNeutral == null) motionNeutral = ang;
        const maxA = (22 * Math.PI / 180) / settings.sensitivity;   // full lock at ~22 degrees of wheel turn
        raw = clamp(wrapAngle(ang - motionNeutral) / maxA, -1, 1);
      } else {
        // phone held nearly flat: use the SDK's normalised tilt control
        const c = snap.control || { x: 0, y: 0 };
        raw = clamp((c.x || 0) * settings.sensitivity, -1, 1);
      }
      if (settings.invertTilt) raw = -raw;
      // reject spikes (limit how fast the raw reading may move), then low-pass the remaining noise
      const lim = approach(tilt.filt, raw, 16 * dt);
      tilt.filt = damp(tilt.filt, lim, 24, dt);
      const dz = settings.deadzone, a = Math.abs(tilt.filt);
      if (a <= dz) return 0;
      const v = (a - dz) / (1 - dz);
      return Math.sign(tilt.filt) * (0.7 * v + 0.3 * v * v);   // responsive near centre, full lock at the edge
    }

    // ---- race setup ----
    function clearCars() {
      for (const c of cars) scene.remove(c.vis.group);
      cars.length = 0;
    }
    function setupRace() {
      seed = (Date.now() & 0xffff) + 99;
      clearCars();
      smoke.clear();
      const N = raceMode === "tt" ? 1 : settings.grid;
      const playerSlot = raceMode === "tt" ? 0 : settings.difficulty === "easy" ? Math.floor(N / 2) - 1 : settings.difficulty === "hard" ? N - 1 : N - 2;
      const teamPool = TEAMS.map((_, i) => i).filter(i => i !== settings.livery);
      const skillBase = DIFF[settings.difficulty] * tune("ai_pace", 1);
      for (let k = 0; k < N; k++) {
        const isPlayer = k === playerSlot;
        const team = isPlayer ? settings.livery : teamPool[(k - (k > playerSlot ? 1 : 0)) % teamPool.length];
        const car = makeCarState(team, isPlayer, isPlayer ? "YOU" : DRIVERS[k % DRIVERS.length]);
        const sl = GRID_SLOT(k);
        placeCarAt(car, sl.s, sl.d);
        car.progress = sl.s;
        car.gridPos = k + 1;
        if (!isPlayer) {
          // faster cars toward the front of the grid
          const ord = 1 - k / Math.max(1, N - 1);
          const cv = []; for (let q = 0; q < 24; q++) cv.push(1 + rrange(-0.018, 0.012) * (settings.difficulty === "easy" ? 1.6 : 1));
          car.ai = {
            skill: skillBase * (0.985 + ord * 0.03 + rrange(-0.012, 0.012)),
            aggr: settings.difficulty === "hard" ? 0.8 : settings.difficulty === "easy" ? 0.35 : 0.6,
            defend: settings.difficulty === "hard" ? 0.5 : settings.difficulty === "easy" ? 0.1 : 0.3,
            bias: rrange(-0.7, 0.7), lane: sl.d - racing.off[car.idx], laneTarget: 0, passing: 0, think: rand() * 0.1,
            ctrl: { steer: 0, throttle: 0, brake: 0, boost: false, slip: 0, gripAssist: 1, rearAssist: 1 },
            react: rrange(0.15, 0.55), lastTarget: 80, cornerVar: cv, ahead: null, aheadGap: 1e9, reverseT: 0
          };
        } else {
          player = car;
          if (TEST && TEST.autopilot) {
            car.ai = {
              skill: TEST.skill || DIFF.hard, aggr: 0.6, defend: 0, bias: 0, lane: sl.d - racing.off[car.idx], laneTarget: 0, passing: 0, think: 0,
              ctrl: { steer: 0, throttle: 0, brake: 0, boost: false, slip: 0, gripAssist: TEST.ga || 1, rearAssist: TEST.ra || 1 },
              react: 0.2, lastTarget: 80, cornerVar: [1], ahead: null, aheadGap: 1e9
            };
          }
        }
        cars.push(car);
      }
      raceTime = 0; finishCount = 0; penaltyMs = 0; trackLimitWarnings = 0; offTrackTimer = 0;
      finishedT = 0; resetHold = 0;
      for (const c of cars) { c.lapStart = 0; c.lapsDone = -1; c.finished = false; c.finishTime = null; c.lastLap = null; c.bestLap = null; c.lapValid = true; c.lapTimes = []; c.boost = 1; }
      guide.mesh.visible = !!settings.racingLine;
      camInit = false; CAM.trans = null; CAM.shake = 0;
      setCamMode(settings.view, false);
      resetControls();
      raceAccum = 0;
      refreshLeaderboardRows();
    }
    function startRaceFlow(isRestart, mode) {
      if (mode) raceMode = mode;
      raceLaps = raceMode === "tt" ? settings.ttLaps : settings.laps;
      attempt++;
      requestLandscape();
      audio.init(); audio.resume(); audio.setVolume();
      ctx.platform.start({ attempt, laps: raceLaps, difficulty: settings.difficulty, mode: raceMode });
      motionFallback = false;
      if (settings.steering === "motion") startMotion(); else motionActive = false;
      setupRace();
      ghost.rec = []; ghost.recT = 0; wrongDist = 0; wrongLast = null;
      if (raceMode === "tt") { loadGhost(); fetchWorldBest(); }
      if (showcase) showcase.group.visible = false;
      paused = false; closeModal();
      setState(isRestart ? "countdown" : "preRace");
    }

    // ---- state transitions ----
    function setState(s) {
      state = s;
      menu.classList.toggle("fr-hide", s !== "menu");
      carSel.classList.toggle("fr-hide", s !== "carSelect");
      circSel.classList.toggle("fr-hide", s !== "circuitSelect");
      preRace.classList.toggle("fr-hide", s !== "preRace");
      hud.classList.toggle("fr-hide", !(s === "countdown" || s === "racing" || s === "finished"));
      loading.classList.add("fr-hide");
      if (s === "menu" || s === "carSelect" || s === "circuitSelect") {
        clearCars(); player = null;
        if (!showcase) refreshShowcase();
        showcase.group.visible = true;
        placeShowcase();
        guide.mesh.visible = false;
        setStartLights(0);
        audio.silence();
        if (s === "carSelect") renderLiveries();
        if (s === "circuitSelect") renderCircuits();
      }
      if (s === "preRace") {
        preRaceT = 0;
        const t = TEAMS[settings.livery];
        $(".fr-pre-title", preRace).textContent = raceMode === "tt" ? `TIME TRIAL · ${raceLaps} LAP${raceLaps > 1 ? "S" : ""}` : `${raceLaps} LAP${raceLaps > 1 ? "S" : ""} · START P${player.gridPos}/${cars.length}`;
        const steerTxt = effectiveSteering() === "motion" ? "Tilt to steer" : "◀ ▶ to steer";
        $(".fr-pre-sub", preRace).innerHTML = `${t.name} #${t.num} · ${raceMode === "tt" ? (ghost.data ? "GHOST " + fmtTime(ghost.data.t) : "SET A LAP TO RACE YOUR GHOST") : settings.difficulty.toUpperCase()}<br>${steerTxt} · hold GAS to go · BRAKE before corners`;
      }
      if (s === "countdown") {
        if (camMode === 1 && camInit) beginCamTransition();
        countdownT = 0; lightsLit = 0; lightsOutAt = 5 + 0.4 + rand() * 1.1;
        motionNeutral = null;
        H.lights.classList.remove("fr-hide");
        lightEls.forEach(l => l.classList.remove("lit"));
        setStartLights(0);
        H.timer.textContent = fmtTime(0);
        showHint(effectiveSteering() === "motion" ? "Hold your phone in a comfortable driving position.<br>Rev with GAS — go when the lights go out!" : "Hold GAS to rev — go when the lights go out!", 4.5);
        layoutHud();
      }
      if (s === "results") showResults();
      else resultsEl.classList.add("fr-hide");
    }

    let hintT = 0;
    function showHint(html, sec) { H.hint.innerHTML = html; H.hint.classList.remove("fr-hide"); hintT = sec; }
    let bannerT = 0;
    function banner(text, sec, color) {
      H.banner.textContent = text; H.banner.style.color = color || "#fff"; H.banner.style.opacity = "1"; bannerT = sec || 1.6;
    }

    // ---- leaderboard / positions ----
    function standings() {
      return cars.slice().sort((a, b) => {
        if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
        if (a.finished) return -1;
        if (b.finished) return 1;
        return b.progress - a.progress;
      });
    }
    let lbRows = [], lbLaidOut = false;
    function refreshLeaderboardRows() { lbRows = []; H.lb.innerHTML = ""; if (typeof lapListKey !== "undefined") lapListKey = ""; }
    function updateLeaderboard() {
      const st = standings();
      const me = st.indexOf(player);
      let from = clamp(me - 2, 0, Math.max(0, st.length - 5));
      const rows = st.slice(from, from + 5);
      const lead = st[0];
      let html = "";
      rows.forEach((c, i) => {
        const pos = from + i + 1;
        let gap = "";
        if (pos === 1) gap = "LEADER";
        else if (raceTime <= 0) gap = "";
        else if (c.finished && lead.finished) gap = "+" + ((c.finishTime - lead.finishTime) / 1000).toFixed(1);
        else {
          const ahead = st[pos - 2];
          const dist = ahead.progress - c.progress;
          const sp = Math.max(c.u, 20);
          gap = "+" + (dist / sp).toFixed(1);
        }
        const t = TEAMS[c.team];
        html += `<div class="fr-lb-row${c === player ? " me" : ""}"><span style="width:1.4em;text-align:right;opacity:.8">${pos}</span><span style="width:.25em;height:1em;background:${t.body};border-radius:1px"></span><span style="width:3.2em">${c === player ? "YOU" : t.code}</span><span style="margin-left:auto;opacity:.75;font-weight:500">${gap}</span></div>`;
      });
      H.lb.innerHTML = html;
      if (!lbLaidOut) { lbLaidOut = true; layoutHud(); }
      return me;
    }
    function updateMinimap() {
      if (mapState.els.length !== cars.length) {
        mapState.dots.innerHTML = "";
        mapState.els = cars.map(c => {
          const e = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          e.setAttribute("r", c.isPlayer ? "3.2" : "2.2");
          e.setAttribute("fill", c.isPlayer ? "#ff2a3d" : TEAMS[c.team].body);
          e.setAttribute("stroke", c.isPlayer ? "#fff" : "#000"); e.setAttribute("stroke-width", c.isPlayer ? "1" : "0.6");
          mapState.dots.appendChild(e);
          return e;
        });
        // player on top
        const pi = cars.indexOf(player);
        if (pi >= 0) mapState.dots.appendChild(mapState.els[pi]);
      }
      cars.forEach((c, i) => { mapState.els[i].setAttribute("cx", mapState.mx(c.x).toFixed(1)); mapState.els[i].setAttribute("cy", mapState.mz(c.z).toFixed(1)); });
    }

    // ---- lap logic ----
    function checkLaps(car) {
      const done = Math.floor(car.progress / TLEN);
      if (done > car.lapsDone) {
        const prev = car.lapsDone;
        car.lapsDone = done;
        if (prev >= 0 && raceTime > 0) {
          const lt = raceTime - car.lapStart;
          car.lastLap = lt;
          car.lapTimes.push({ t: lt, valid: car.lapValid });
          if (car.lapValid && (car.bestLap == null || lt < car.bestLap)) car.bestLap = lt;
          if (car === player) { onPlayerLap(lt, car.lapValid); ghostLapDone(lt, car.lapValid); }
        }
        if (prev >= 0) car.lapStart = raceTime;
        car.lapValid = true;
        if (car.lapsDone >= raceLaps && !car.finished) {
          car.finished = true; car.finishTime = raceTime; car.finishOrder = ++finishCount;
          if (car === player) onPlayerFinish();
        }
      }
    }
    function onPlayerLap(lt, valid) {
      ctx.platform.milestone("lap_complete", { lap: player.lapsDone, timeMs: Math.round(lt), valid });
      if (player.lapsDone < raceLaps) {
        const isBest = valid && player.bestLap === lt;
        banner(`LAP ${fmtTime(lt)}`, 1.8, isBest ? "#b26bff" : valid ? "#fff" : "#ffcf2e");
        if (player.lapsDone === raceLaps - 1) {
          ctx.timeout(() => { if (!disposed && state === "racing") banner("FINAL LAP", 1.8, "#fff"); }, 1900);
          audio.blip(880, 0.15, "triangle", 0.2); audio.blip(1175, 0.2, "triangle", 0.2, 0.16);
        }
      }
      if (valid && (bestLapStored == null || lt < bestLapStored)) {
        bestLapStored = lt;
        try { ctx.storage.set(bestLapKey(), lt); } catch (e) { /* ignore */ }
      }
    }
    function onPlayerFinish() {
      state = "finished";
      finishedT = 0;
      if (raceMode === "tt") banner("TIME TRIAL COMPLETE", 3.2, "#36c8ff");
      else banner(player.finishOrder === 1 ? "VICTORY!" : `FINISHED P${player.finishOrder}`, 3.2, player.finishOrder === 1 ? "#ffcf2e" : "#fff");
      audio.fanfare();
      haptic("success");
      ctx.platform.milestone("race_finished", { position: player.finishOrder });
      // player car goes to autopilot for a cooldown lap
      player.ai = {
        skill: 0.7, aggr: 0, defend: 0, bias: 0, lane: 0, laneTarget: 0, passing: 0, think: 0,
        ctrl: { steer: 0, throttle: 0, brake: 0, boost: false, slip: 0, gripAssist: 1.05, rearAssist: 1.1 },
        react: 0, lastTarget: 50, cornerVar: [1], ahead: null, aheadGap: 1e9
      };
    }
    function requestReset() {
      if (state !== "racing" || !player || player.holdTimer > 0) return;
      resetCar(player, true);
    }
    function resetCar(car, penalize) {
      // nearest safe point, facing the right way, clear of other cars
      project(car.x, car.z, car.idx, projTmp, !track.bridge);
      let s = projTmp.s - 4;
      let placed = false;
      for (let tries = 0; tries < 12 && !placed; tries++) {
        for (const d of [racing.off[Math.floor(((s / TDS) % TN + TN) % TN)], 0, -3.5, 3.5]) {
          const p = sampleAt(s);
          const x = p.x + p.rx * d, z = p.z + p.rz * d;
          let clear = true;
          for (const o of cars) { if (o !== car && Math.hypot(o.x - x, o.z - z) < 7 && Math.abs(track.Y[o.idx] - p.y) < 3) { clear = false; break; } }
          if (clear) {
            const keepProgress = car.progress;
            placeCarAt(car, s, d);
            let dp = s - (((keepProgress % TLEN) + TLEN) % TLEN);
            if (dp > TLEN / 2) dp -= TLEN; if (dp < -TLEN / 2) dp += TLEN;
            car.progress = keepProgress + dp;
            placed = true; break;
          }
        }
        s -= 8;
      }
      if (TEST) TEST.stats.resets.push({ name: car.name, s: Math.round(car.s), t: Math.round(raceTime) });
      car.holdTimer = penalize ? 1.6 : 0.6;
      car.stuckTimer = 0;
      if (car === player) { banner("RESET", 1.2, "#ffcf2e"); haptic("medium"); camInit = false; }
    }

    // ---- results ----
    const resultsEl = el("div", "fr-screen fr-results fr-hide");
    ctx.listen(resultsEl, "click", delegate);
    resultsEl.style.pointerEvents = "auto";
    resultsEl.style.background = "linear-gradient(90deg,rgba(4,6,11,.92),rgba(4,6,11,.7))";
    function showTTResults() {
      const laps = player.lapTimes || [];
      let best = null;
      for (const l of laps) if (l.valid && (best == null || l.t < best)) best = l.t;
      const total = player.finishTime + penaltyMs;
      const rows = laps.map((l, i) => `<div class="fr-lb-row" style="font-size:.85em"><span style="width:3em;opacity:.7">LAP ${i + 1}</span><span style="margin-left:auto;color:${!l.valid ? "#ffcf2e" : l.t === best ? "#b26bff" : "#fff"}">${fmtTime(l.t)}${l.valid ? "" : " (invalid)"}</span></div>`).join("");
      resultsEl.innerHTML = `
        <div class="fr-res-left" style="position:absolute;left:var(--pl);top:var(--pt);bottom:var(--pb);width:44%;display:flex;flex-direction:column;justify-content:center;padding-left:1em">
          <div style="font-size:.85em;letter-spacing:.3em;color:#36c8ff">TIME TRIAL · ${circuit.name.toUpperCase()}</div>
          <div style="font-size:3.6em;line-height:.95;color:#b26bff">${fmtTime(best)}</div>
          <div class="fr-ui" style="display:grid;grid-template-columns:auto auto;gap:.25em 1.2em;font-size:.8em;margin:.6em 0 .9em">
            <div style="opacity:.6">Total time</div><div style="font-weight:700">${fmtTime(total)}</div>
            <div style="opacity:.6">Personal best lap</div><div style="font-weight:700">${fmtTime(bestLapStored)}</div>
            <div style="opacity:.6">Ghost</div><div style="font-weight:700;color:#7fd0ff">${ghost.data ? fmtTime(ghost.data.t) : "–"}</div>
            ${ghost.world != null ? `<div style="opacity:.6">Leaderboard best</div><div style="font-weight:700;color:#ffcf2e">${fmtTime(ghost.world)}</div>` : ""}
          </div>
          <div style="display:flex;gap:.6em;flex-wrap:wrap">
            <button class="fr-menu-btn primary fr-again" style="width:auto;text-align:center">GO AGAIN</button>
            <button class="fr-menu-btn fr-home" style="width:auto;text-align:center">MAIN MENU</button>
          </div>
        </div>
        <div class="fr-panel fr-res-right" style="position:absolute;right:var(--pr);top:var(--pt);bottom:var(--pb);width:46%;padding:.5em .4em;display:flex;flex-direction:column">
          <div style="font-size:1em;letter-spacing:.12em;padding:0 .4em .3em">LAP TIMES</div>
          <div class="fr-scroll" style="flex:1;min-height:0">${rows}</div>
        </div>`;
      resultsEl.classList.remove("fr-hide");
      bindAct($(".fr-again", resultsEl), () => { audio.resume(); startRaceFlow(true); });
      bindAct($(".fr-home", resultsEl), () => setState("menu"));
      const myAttempt = attempt;
      requestAnimationFrameSafe(() => {
        if (disposed || myAttempt !== attempt) return;
        try { ctx.pulse.complete({ timeMs: Math.round(best != null ? best : total), timeLabel: fmtTime(best != null ? best : total), result: "time trial", mode: "time_trial", text: `Time trial at ${circuit.name} · best lap ${fmtTime(best)}` }); } catch (e) { /* ignore */ }
      });
      if (best != null && ctx.memory && ctx.memory.record) {
        try { ctx.memory.record("best_lap").submit(Math.round(best), { label: fmtTime(best), dimensions: { circuit: circuit.record } }).catch(() => {}); } catch (e) { /* ignore */ }
      }
    }
    function showResults() {
      if (raceMode === "tt") return showTTResults();
      const st = standings();
      // estimate finish times for cars still running
      const avg = player.finishTime / Math.max(1, raceLaps * TLEN);
      const rowsData = st.map(c => {
        let t = c.finishTime;
        if (!c.finished) t = raceTime + (raceLaps * TLEN - c.progress) * avg * 1.02;
        return { c, t };
      });
      rowsData.sort((a, b) => a.t - b.t);
      const myPos = rowsData.findIndex(r => r.c === player) + 1;
      const total = player.finishTime + penaltyMs;
      const best = player.bestLap;
      let rows = "";
      rowsData.forEach((r, i) => {
        const t = TEAMS[r.c.team];
        const gap = i === 0 ? fmtTime(r.t + (r.c === player ? penaltyMs : 0)) : "+" + ((r.t - rowsData[0].t) / 1000).toFixed(3);
        rows += `<div class="fr-lb-row${r.c === player ? " me" : ""}" style="font-size:.78em"><span style="width:1.6em;text-align:right">${i + 1}</span><span style="width:.3em;height:1em;background:${t.body}"></span><span style="width:8em;overflow:hidden;text-overflow:ellipsis">${r.c === player ? "YOU" : r.c.name}</span><span style="width:8.5em;opacity:.7;overflow:hidden;text-overflow:ellipsis">${t.name}</span><span style="margin-left:auto">${gap}</span></div>`;
      });
      resultsEl.innerHTML = `
        <div class="fr-res-left" style="position:absolute;left:var(--pl);top:var(--pt);bottom:var(--pb);width:44%;display:flex;flex-direction:column;justify-content:center;padding-left:1em">
          <div style="font-size:.85em;letter-spacing:.3em;color:#ff2a3d">RACE RESULT · ${circuit.name.toUpperCase()}</div>
          <div style="font-size:4.6em;line-height:.95">P${myPos}<span style="font-size:.4em;opacity:.6"> / ${cars.length}</span></div>
          <div class="fr-ui" style="display:grid;grid-template-columns:auto auto;gap:.25em 1.2em;font-size:.8em;margin:.6em 0 .9em">
            <div style="opacity:.6">Race time</div><div style="font-weight:700">${fmtTime(total)}${penaltyMs ? ` <span style="color:#ffcf2e">(+${(penaltyMs / 1000).toFixed(0)}s pen.)</span>` : ""}</div>
            <div style="opacity:.6">Best lap</div><div style="font-weight:700;color:#b26bff">${fmtTime(best)}</div>
            <div style="opacity:.6">Laps</div><div style="font-weight:700">${Math.min(player.lapsDone, raceLaps)} / ${raceLaps}</div>
            <div style="opacity:.6">Personal best lap</div><div style="font-weight:700">${fmtTime(bestLapStored)}</div>
          </div>
          <div style="display:flex;gap:.6em;flex-wrap:wrap">
            <button class="fr-menu-btn primary fr-again" style="width:auto;text-align:center">RESTART RACE</button>
            <button class="fr-menu-btn fr-home" style="width:auto;text-align:center">MAIN MENU</button>
          </div>
        </div>
        <div class="fr-panel fr-res-right" style="position:absolute;right:var(--pr);top:var(--pt);bottom:var(--pb);width:46%;padding:.5em .4em;display:flex;flex-direction:column">
          <div style="font-size:1em;letter-spacing:.12em;padding:0 .4em .3em">CLASSIFICATION</div>
          <div class="fr-scroll" style="flex:1;min-height:0">${rows}</div>
        </div>`;
      resultsEl.classList.remove("fr-hide");
      bindAct($(".fr-again", resultsEl), () => { audio.resume(); startRaceFlow(true); });
      bindAct($(".fr-home", resultsEl), () => setState("menu"));
      // platform: pulse + best-lap record (detached; never blocks replay)
      const myAttempt = attempt;
      requestAnimationFrameSafe(() => {
        if (disposed || myAttempt !== attempt) return;
        try {
          ctx.pulse.complete({ timeMs: Math.round(total), timeLabel: fmtTime(total), result: `P${myPos}`, mode: settings.difficulty, text: `Finished P${myPos} of ${cars.length} at ${circuit.name} · best lap ${fmtTime(best)}` });
        } catch (e) { /* ignore */ }
      });
      if (best != null && ctx.memory && ctx.memory.record) {
        try {
          ctx.memory.record("best_lap").submit(Math.round(best), { label: fmtTime(best), dimensions: { circuit: circuit.record } })
            .catch(() => {});
        } catch (e) { /* ignore */ }
      }
    }
    function requestAnimationFrameSafe(fn) { ctx.timeout(fn, 120); }

    // =====================================================================
    // Cam
    // =====================================================================
    // One render viewCam. Two rigs (chase / cockpit) compute target poses from the car's
    // interpolated transform; a short blend handles switching. Cam code never writes car state.
    let camInit = false;
    const UP = new THREE.Vector3(0, 1, 0);
    const CAM = { yaw: 0, accel: 0, pushX: 0, pushZ: 0, lift: 0, shake: 0, shakeT: 0, fov: 58, trans: null };
    const tgt = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 58, near: 0.3 };
    const _look = new THREE.Vector3(), _m4 = new THREE.Matrix4(), _eul = new THREE.Euler(0, 0, 0, "YXZ");
    const _cq = new THREE.Quaternion(), _from = new THREE.Vector3(), _fromQ = new THREE.Quaternion();
    function setCamFov(vfov16x9) {
      // vfov is authored for 16:9; narrower landscape ratios widen it so horizontal coverage holds
      const aspect = VR.w / Math.max(1, VR.h);
      let f = vfov16x9;
      if (aspect < 16 / 9) {
        const hf = 2 * Math.atan(Math.tan(f * Math.PI / 360) * 16 / 9);
        f = 2 * Math.atan(Math.tan(hf / 2) / aspect) * 180 / Math.PI;
      }
      viewCam.aspect = aspect; viewCam.fov = f;
      viewCam.updateProjectionMatrix();
    }
    function setNear(n) { viewCam.near = n; }
    function chaseTarget(c, dt, out) {
      const speed = Math.max(0, c.u), sp = clamp(speed / 85, 0, 1);
      // heading follows the car with a short exponential lag: the car swings within the frame in turns
      CAM.yaw = c.rh + wrapAngle(CAM.yaw - c.rh) * Math.exp(-dt * 6.5);
      CAM.accel = damp(CAM.accel, clamp(c.ax, -40, 20), 4, dt);
      const fx = Math.sin(CAM.yaw), fz = Math.cos(CAM.yaw);
      const dist = 6.1 + sp * 0.6 - CAM.accel * 0.006;
      const height = 1.92 + sp * 0.08;
      const yBehind = track.bridge ? sampleAt(c.rs - dist).y : 0;
      out.pos.set(c.rx - fx * dist, height + yBehind, c.rz - fz * dist);
      // barriers: ease the viewCam back inside rather than snapping through walls
      project(out.pos.x, out.pos.z, c.idx, projTmp, false);
      const lim = (projTmp.d < 0 ? track.limL[projTmp.idx] : track.limR[projTmp.idx]) - 0.9;
      let px = 0, pz = 0;
      if (Math.abs(projTmp.d) > lim) {
        const over = Math.abs(projTmp.d) - lim, sg = Math.sign(projTmp.d);
        px = -track.RX[projTmp.idx] * over * sg; pz = -track.RZ[projTmp.idx] * over * sg;
      }
      CAM.pushX = damp(CAM.pushX, px, 12, dt); CAM.pushZ = damp(CAM.pushZ, pz, 12, dt);
      // other cars close to the lens: rise smoothly over them instead of clipping through
      let lift = 0;
      for (const o of cars) {
        if (o === c || Math.abs(o.ry - c.ry) > 3) continue;
        const d = Math.hypot(o.rx - out.pos.x, o.rz - out.pos.z);
        if (d < 3.2) lift = Math.max(lift, (3.2 - d) * 0.45);
      }
      CAM.lift = damp(CAM.lift, lift, 8, dt);
      out.pos.x += CAM.pushX; out.pos.z += CAM.pushZ; out.pos.y += CAM.lift;
      // curb bumps follow the car's own suspension; impacts use a short decaying wobble (no random noise)
      out.pos.y += c.susp * 0.6 + CAM.shake * 0.07 * Math.sin(CAM.shakeT * 31);
      out.pos.x += CAM.shake * 0.04 * Math.sin(CAM.shakeT * 23 + 1);
      out.pos.y = Math.max(out.pos.y, 0.6 + yBehind);
      _look.set(c.rx + fx * 13, 0.45 + (track.bridge ? sampleAt(c.rs + 13).y : 0), c.rz + fz * 13);
      _m4.lookAt(out.pos, _look, UP);
      out.quat.setFromRotationMatrix(_m4);
      out.fov = 55 + sp * 7; out.near = 0.3;
    }
    function cockpitTarget(c, dt, out) {
      // driver's eye inside the cockpit, just under the halo hoop, looking along the car's axis
      const sp = clamp(Math.max(0, c.u) / 85, 0, 1);
      const fx = Math.sin(c.rh), fz = Math.cos(c.rh);
      out.pos.set(c.rx - fx * 0.04, 0.88 + c.susp + c.ry, c.rz - fz * 0.04);
      _eul.set(-0.03 + c.slope - c.pitch * 0.6 + CAM.shake * 0.01 * Math.sin(CAM.shakeT * 31), c.rh + Math.PI, 0, "YXZ");
      out.quat.setFromEuler(_eul);
      out.fov = 60 + sp * 4; out.near = 0.05;
    }
    function camTarget(mode, c, dt) { if (mode === 1) cockpitTarget(c, dt, tgt); else chaseTarget(c, dt, tgt); return tgt; }
    function beginCamTransition() {
      // store the currently rendered pose in the car's local frame so the blend travels with the car
      const c = player;
      if (!c || !camInit) return;
      _cq.setFromAxisAngle(UP, c.rh);
      const inv = _cq.clone().invert();
      CAM.trans = {
        t: 0, dur: 0.32,
        pos: viewCam.position.clone().sub(new THREE.Vector3(c.rx, c.ry, c.rz)).applyQuaternion(inv),
        quat: inv.multiply(viewCam.quaternion),
        fov: CAM.fov, near: viewCam.near
      };
    }
    function setCamMode(mode, animate) {
      if (mode !== 0 && mode !== 1) mode = 0;
      if (mode !== camMode) {
        if (animate) beginCamTransition();
        if (mode === 0 && player) { CAM.yaw = player.rh; CAM.pushX = CAM.pushZ = CAM.lift = 0; }
        camMode = mode;
      }
      settings.view = mode; saveSettings();
      H.camLabel.textContent = mode === 1 ? "COCKPIT" : "CHASE";
      H.cam.classList.toggle("on", mode === 1);
      layoutHud();
    }
    function toggleCam() {
      if (!(state === "countdown" || state === "racing" || state === "finished")) return;
      setCamMode(camMode === 1 ? 0 : 1, true);
      ctx.platform.interact({ type: "view", mode: camMode === 1 ? "cockpit" : "chase" });
    }
    function applyCamPose(pos, quat, fov, near) {
      viewCam.position.copy(pos);
      viewCam.quaternion.copy(quat);
      CAM.fov = fov;
      setNear(near);
      setCamFov(fov);
    }
    function updateRaceCam(dt) {
      const c = player;
      if (!camInit) { CAM.yaw = c.rh; camInit = true; }
      CAM.shake = Math.max(0, CAM.shake - dt * 3); CAM.shakeT += dt;
      const T = camTarget(camMode, c, dt);
      let cockpitVis = camMode === 1;
      if (CAM.trans) {
        const tr = CAM.trans;
        tr.t += dt;
        const k0 = clamp(tr.t / tr.dur, 0, 1), k = k0 * k0 * (3 - 2 * k0);
        _cq.setFromAxisAngle(UP, c.rh);
        _from.copy(tr.pos).applyQuaternion(_cq).add(_look.set(c.rx, c.ry, c.rz));
        _fromQ.copy(_cq).multiply(tr.quat);
        _from.lerp(T.pos, k);
        _from.y += Math.sin(Math.PI * k) * 0.35;   // arc over the engine cover, never through the car
        _fromQ.slerp(T.quat, k);
        applyCamPose(_from, _fromQ, lerp(tr.fov, T.fov, k), Math.min(tr.near, T.near));
        cockpitVis = camMode === 1 ? k > 0.6 : k < 0.4;
        if (k0 >= 1) CAM.trans = null;
      } else {
        applyCamPose(T.pos, T.quat, T.fov, T.near);
      }
      c.vis.helmet.visible = !cockpitVis;
    }

    // =====================================================================
    // Visual sync for cars
    // =====================================================================
    // height and pitch on the crossover ramps, from the rendered position
    const heightTmp = { idx: 0, s: 0, d: 0 };
    function carHeight(c) {
      project(c.rx, c.rz, c.idx, heightTmp, false);
      c.rs = heightTmp.s;
      const p = sampleAt(c.rs);
      c.ry = p.y;
      const grade = (sampleAt(c.rs + 2).y - sampleAt(c.rs - 2).y) / 4;
      c.slope = Math.atan(grade * (Math.sin(c.rh) * p.fx + Math.cos(c.rh) * p.fz));
    }
    function syncCarVisual(c, dt) {
      const v = c.vis;
      v.group.position.set(c.rx, c.ry, c.rz);
      v.group.rotation.set(-c.slope, c.rh, 0, "YXZ");
      // suspension: pitch from accel, roll from lateral, bounce on curbs
      const latAcc = c.u * c.wr;
      c.pitch = damp(c.pitch, clamp(-c.ax * 0.0035, -0.03, 0.03), 8, dt);
      c.roll = damp(c.roll, clamp(latAcc * 0.0016, -0.03, 0.03), 8, dt);
      const bumpTarget = c.onCurb ? Math.sin(performance.now() * 0.06 + c.team) * 0.025 : c.surf >= 2 ? Math.sin(performance.now() * 0.04) * 0.035 : 0;
      c.susp = damp(c.susp, bumpTarget, 20, dt);
      v.body.rotation.set(c.pitch, 0, c.roll);
      v.body.position.y = c.susp;
      c.wheelRot += c.u * dt / 0.36;
      for (let i = 0; i < 4; i++) {
        const w = v.wheels[i];
        w.spin.rotation.x = c.wheelRot;
        if (!w.rear) w.steer.rotation.y = -c.steer * 0.36 * clamp(1 - Math.abs(c.u) / 120, 0.4, 1);
        w.steer.position.y = (w.rear ? 0.37 : 0.36) + c.susp * 0.6;
      }
      if (v.wheelRim) v.wheelRim.rotation.z = c.steer * 1.6;
      const glow = c.brake > 0.3 && c.u > 25 ? Math.min(1, (c.u - 25) / 40) * c.brake : 0;
      v.mats.disc.emissiveIntensity = damp(v.mats.disc.emissiveIntensity, glow * 2.2, glow > 0 ? 6 : 1.5, dt);
    }

    // =====================================================================
    // Main loop
    // =====================================================================
    let raceAccum = 0, lineColorT = 0, hudT = 0, smokeT = 0, curbHapticT = 0;
    const FIXED = 1 / 120;

    // Single source of truth for the player's intent. Every input method writes into `input`/`keys`;
    // this shapes them once per physics step (fixed dt), so response is frame-rate independent.
    const controls = { steer: 0, throttle: 0, brake: 0, boost: false, reverse: false, src: "none" };
    function resetControls() { controls.steer = controls.throttle = controls.brake = 0; controls.boost = controls.reverse = false; reverseHold = 0; tilt.filt = 0; }
    function updateControls(dt) {
      const kL = keys.has("arrowleft") || keys.has("a"), kR = keys.has("arrowright") || keys.has("d");
      const kUp = keys.has("arrowup") || keys.has("w"), kDn = keys.has("arrowdown") || keys.has("s") || keys.has(" ");
      const gasHeld = !!(input.gas || kUp), brakeHeld = !!(input.brake || kDn);
      // steering source priority is deterministic: held buttons/keys, else tilt (tilt mode only), else centre
      let target = 0, src = "none";
      const tiltMode = effectiveSteering() === "motion";
      const btn = tiltMode ? 0 : (input.right || kR ? 1 : 0) - (input.left || kL ? 1 : 0);
      if (btn !== 0) { target = btn; src = "buttons"; }
      else if (effectiveSteering() === "motion") { const t = readTilt(dt); if (t != null) { target = t; src = "tilt"; } }
      const u = Math.max(0, player.u);
      const spN = clamp(u / 80, 0, 1);
      target *= lerp(1, src === "tilt" ? 0.85 : 0.75, clamp((u - 30) / 55, 0, 1));     // less authority at speed
      let rate;
      if (src === "tilt") rate = 11;                               // already filtered: only limit slew
      else if (target === 0) rate = lerp(6, 4.5, spN);            // smooth return to centre
      else if (controls.steer !== 0 && Math.sign(target) !== Math.sign(controls.steer)) rate = lerp(8, 5.5, spN); // counter-steer
      else rate = lerp(4.5, 2.6, spN);                            // turn-in: quick at low speed, calmer at high speed
      controls.steer = approach(controls.steer, target, rate * dt);
      controls.throttle = approach(controls.throttle, gasHeld ? 1 : 0, (gasHeld ? 4.5 : 8) * dt);
      controls.brake = approach(controls.brake, brakeHeld ? 1 : 0, (brakeHeld ? 7 : 10) * dt);
      if (brakeHeld && !gasHeld && Math.abs(player.u) < 1) reverseHold += dt; else if (!brakeHeld) reverseHold = 0;
      controls.reverse = reverseHold > 0.35;
      controls.boost = !!(input.boost || keys.has("shift")) && player.boost > 0.02 && u > 10;
      controls.src = src;
      if (TEST && TEST.steerBot) { controls.steer = TEST.steerBot(player); controls.throttle = 1; controls.brake = 0; }
    }
    const approach = (v, t, d) => (v < t ? Math.min(t, v + d) : Math.max(t, v - d));
    const playerCtrlRef = { steer: 0, throttle: 0, brake: 0, boost: false, slip: 0, gripAssist: 1, rearAssist: 1 };

    function slipstreamFor(car) {
      let best = 0;
      const fx = Math.sin(car.h), fz = Math.cos(car.h);
      for (const o of cars) {
        if (o === car || !sameLevel(o, car)) continue;
        const dx = o.x - car.x, dz = o.z - car.z;
        const lon = dx * fx + dz * fz;
        if (lon < 3 || lon > 34) continue;
        const lat = Math.abs(dx * (-fz) + dz * fx);
        if (lat > 2.2) continue;
        const s = (1 - (lon - 3) / 31) * 0.3 * clamp((car.u - 30) / 30, 0, 1);
        best = Math.max(best, s);
      }
      return best;
    }

    // Auto brake assist: the car brakes for corners by itself (the player steers and holds GAS)
    function autoBrake(car, ctrl) {
      const speed = Math.max(0, car.u);
      let target = racing.v[(car.idx + Math.round(Math.max(4, speed * 0.25) / TDS)) % TN];
      for (let k = 1; k < 40; k += 3) {
        const j = (car.idx + k * 2) % TN, dist = k * 2 * TDS, vj = racing.v[j];
        const brakeCap = 0.78 * PHYS.brakeMu * PHYS.mu * (PHYS.g + PHYS.kd * vj * vj / PHYS.mass);
        target = Math.min(target, Math.sqrt(vj * vj + 2 * brakeCap * dist));
      }
      target *= 0.96 - 0.01 * Math.min(4, Math.max(0, Math.abs(car.d - racing.off[car.idx]) - 1.5));
      car.autoBraking = false;
      if (speed > target + 0.6) {
        ctrl.throttle = 0;
        ctrl.brake = Math.max(ctrl.brake, clamp((speed - target) * 0.4, 0.25, 1));
        car.autoBraking = true;
      } else if (speed > target - 1.5) ctrl.throttle = Math.min(ctrl.throttle, 0.35);
    }
    function simulate(dt) {
      for (const c of cars) { c.px = c.x; c.pz = c.z; c.ph = c.h; }
      const racingOn = state === "racing" || state === "finished";
      if (racingOn) raceTime += dt * 1000;
      // controls
      for (const c of cars) {
        let ctrl;
        if (c.holdTimer > 0) {
          c.holdTimer -= dt;
          ctrl = { steer: 0, throttle: 0, brake: 1, boost: false, slip: 0, gripAssist: 1, rearAssist: 1 };
          c.vx *= 0.9; c.vz *= 0.9; c.wr *= 0.8;
        } else if (c.ai && (!c.isPlayer || state === "finished" || (TEST && TEST.autopilot))) {
          const raceOn = racingOn && raceTime / 1000 > c.ai.react;
          ctrl = aiControl(c, dt, raceOn);
          ctrl.slip = slipstreamFor(c);
        } else if (c.isPlayer) {
          if (racingOn) {
            const pc = controls;
            ctrl = playerCtrlRef;
            ctrl.steer = pc.steer; ctrl.throttle = pc.throttle; ctrl.brake = pc.brake; ctrl.boost = pc.boost; ctrl.reverse = !!pc.reverse;
            ctrl.gripAssist = PLAYER_ASSIST[settings.difficulty] || 1; ctrl.rearAssist = ctrl.gripAssist;
            ctrl.brakeAssist = settings.brakeAssist === "full" || settings.brakeAssist === "auto" ? 2 : settings.brakeAssist === "off" ? 0 : 1;
            if (settings.brakeAssist === "auto") autoBrake(c, ctrl);
            ctrl.abs = true;
            ctrl.tc = settings.tc === "full" ? 2 : settings.tc === "off" ? 0 : 1;
            ctrl.slip = slipstreamFor(c);
            c.slipstream = ctrl.slip;
            // ERS energy
            if (ctrl.boost) c.boost = Math.max(0, c.boost - dt / 5);
            else c.boost = Math.min(1, c.boost + dt * (ctrl.brake ? 0.09 : 0.012));
            c.boosting = ctrl.boost;
          } else {
            ctrl = { steer: 0, throttle: 0, brake: 1, boost: false, slip: 0, gripAssist: 1, rearAssist: 1 };
          }
        }
        if (!racingOn) {
          // held on the grid
          c.vx = c.vz = c.wr = 0;
          if (c.isPlayer) { c.throttle = controls.throttle; c.rpm = damp(c.rpm || 4000, 4000 + c.throttle * 8000, 6, dt); }
          continue;
        }
        stepCar(c, dt, ctrl);
        if (TEST && TEST.trace) TEST.trace(c, ctrl, raceTime);
        if (c.gearChanged && c.isPlayer) audio.shift();
      }
      if (!racingOn) return;
      // collisions
      carCollisions((A, B, imp) => {
        for (const c of [A, B]) {
          if (c.isPlayer && imp > 1.2 && c.collideCooldown <= 0) {
            CAM.shake = Math.min(1, CAM.shake + imp * 0.08);
            audio.thud(imp * 1.4);
            haptic(imp > 6 ? "heavy" : "medium");
            c.collideCooldown = 0.25;
          }
        }
      });
      for (const c of cars) {
        c.collideCooldown -= dt;
        const hit = barrierCollide(c);
        if (TEST && hit > 3) TEST.stats.walls.push({ name: c.name, s: Math.round(c.s), v: +hit.toFixed(1), d: +c.d.toFixed(1), h: +wrapAngle(c.h - Math.atan2(track.FX[c.idx], track.FZ[c.idx])).toFixed(2) });
        if (hit > 1 && c.isPlayer && c.collideCooldown <= 0) {
          CAM.shake = Math.min(1, CAM.shake + hit * 0.06);
          audio.thud(hit);
          haptic(hit > 8 ? "heavy" : "medium");
          c.collideCooldown = 0.3;
          if (hit > 6) showWarn("BARRIER CONTACT", 1.2);
        }
        checkLaps(c);
        if (c === player && state === "racing" && !c.finished) recordGhostSample(c);
        // stuck detection for AI
        if (!c.isPlayer || state === "finished" || (TEST && TEST.autopilot)) {
          if (Math.abs(c.u) < 1.5 && c.holdTimer <= 0) c.stuckTimer += dt; else c.stuckTimer = 0;
          if (c.stuckTimer > 4) resetCar(c, false);
        }
      }
      // player-specific: track limits, stuck hint
      if (state === "racing" && player) {
        if (player.offTrack) {
          offTrackTimer += dt;
          if (offTrackTimer > 0.6 && player.lapValid) {
            player.lapValid = false;
            trackLimitWarnings++;
            if (trackLimitWarnings >= 3 && trackLimitWarnings % 3 === 0) {
              penaltyMs += 3000;
              showWarn("TRACK LIMITS · +3s PENALTY", 2.4);
              haptic("warning");
            } else showWarn(`TRACK LIMITS · LAP INVALID (${trackLimitWarnings % 3}/3)`, 2.2);
          }
        } else offTrackTimer = 0;
        if (Math.abs(player.u) < 2 && player.holdTimer <= 0 && raceTime > 4000) {
          player.stuckTimer += dt;
        } else player.stuckTimer = 0;
        if (player.stuckTimer > 3) { H.reset.classList.add("fr-pulse"); } else H.reset.classList.remove("fr-pulse");
        // slip haptics/smoke
        if (player.slip > 0.12 || (player.surf >= 2 && Math.abs(player.u) > 15)) {
          curbHapticT -= dt;
          if (curbHapticT <= 0) { haptic("light"); curbHapticT = 0.35; }
        } else if (player.onCurb && Math.abs(player.u) > 10) {
          curbHapticT -= dt;
          if (curbHapticT <= 0) { haptic("light"); curbHapticT = 0.22; }
        }
      }
    }
    let warnT = 0;
    function showWarn(text, sec) { H.warn.textContent = text; H.warn.classList.remove("fr-hide"); warnT = sec; lastWarnText = text; }

    function updateGuideColors() {
      if (!guide.mesh.visible || !player) return;
      const col = guide.colors;
      const u = Math.max(0, player.u);
      const start = player.idx;
      for (let k = 0; k < 260; k++) {
        const i = (start + k) % TN;
        const vb = guide.map[i];
        if (vb < 0) continue;
        const vt = racing.v[i];
        const dist = Math.max(1, k * TDS - 4);
        const need = (u * u - vt * vt) / (2 * dist);
        let r, g, b;
        const cap = 0.78 * PHYS.mu * (PHYS.g + PHYS.kd * u * u / PHYS.mass);
        if (u > vt + 1.5 && need > cap * 0.55) { r = 1; g = 0.12; b = 0.12; }
        else if (u > vt + 1.5 && need > cap * 0.18) { r = 1; g = 0.8; b = 0.1; }
        else { r = 0.15; g = 0.95; b = 0.45; }
        for (let q = 0; q < 4; q++) col.setXYZ(vb + q, r, g, b);
      }
      col.needsUpdate = true;
    }

    // time trial: lap-by-lap times in place of the standings
    let lapListKey = "";
    function updateLapList() {
      const laps = player.lapTimes || [];
      const key = laps.length + "|" + raceLaps + "|" + (ghost.data ? ghost.data.t : 0) + "|" + (ghost.world || 0) + "|" + (bestLapStored || 0);
      if (key === lapListKey) return;
      lapListKey = key;
      let best = null;
      for (const l of laps) if (l.valid && (best == null || l.t < best)) best = l.t;
      let html = `<div class="fr-lb-row" style="opacity:.7;letter-spacing:.08em">TIME TRIAL · ${raceLaps} LAP${raceLaps > 1 ? "S" : ""}</div>`;
      laps.forEach((l, i) => {
        const col = !l.valid ? "#ffcf2e" : l.t === best ? "#b26bff" : "#fff";
        html += `<div class="fr-lb-row"><span style="width:2.2em;opacity:.7">L${i + 1}</span><span style="margin-left:auto;color:${col}">${fmtTime(l.t)}${l.valid ? "" : " ✕"}</span></div>`;
      });
      if (ghost.data) html += `<div class="fr-lb-row" style="border-top:1px solid rgba(255,255,255,.15)"><span style="opacity:.7">GHOST</span><span style="margin-left:auto;color:#7fd0ff">${fmtTime(ghost.data.t)}</span></div>`;
      if (ghost.world != null) html += `<div class="fr-lb-row"><span style="opacity:.7">TOP</span><span style="margin-left:auto;color:#ffcf2e">${fmtTime(ghost.world)}</span></div>`;
      H.lb.innerHTML = html;
    }
    function updateHud(dt) {
      if (!player) return;
      const kmh = Math.round(Math.abs(player.u) * 3.6);
      H.speed.textContent = String(kmh);
      H.gear.textContent = player.u < -0.5 ? "R" : (Math.abs(player.u) < 0.5 && !player.throttle ? "N" : String(player.gear));
      H.rpm.style.width = clamp((player.rpm - 3800) / 8600 * 100, 0, 100).toFixed(0) + "%";
      H.ers.style.width = (player.boost * 100).toFixed(0) + "%";
      H.boost.classList.toggle("on", !!player.boosting);
      const lapShown = clamp(player.lapsDone + 1, 1, raceLaps);
      H.lap.textContent = `${lapShown}/${raceLaps}`;
      if (raceMode === "tt") {
        const pb = player.bestLap != null && (bestLapStored == null || player.bestLap < bestLapStored) ? player.bestLap : bestLapStored;
        H.posLabel.textContent = "BEST";
        H.pos.textContent = pb != null ? fmtTime(pb) : "--:--";
        updateLapList();
      } else {
        H.posLabel.textContent = "POS";
        const me = updateLeaderboard();
        H.pos.textContent = `P${me + 1}/${cars.length}`;
      }
      // wrong-way warning after 100 m driven against the race direction
      if (wrongLast == null) wrongLast = player.progress;
      const dpw = player.progress - wrongLast; wrongLast = player.progress;
      if (state === "racing" && !player.finished && player.holdTimer <= 0 && Math.abs(dpw) < 20) {
        if (dpw < 0) wrongDist -= dpw; else wrongDist = Math.max(0, wrongDist - dpw * 2);
      } else if (state !== "racing") wrongDist = 0;
      const ww = wrongDist >= 100 || (H.wwOn && wrongDist > 30);
      if (ww !== !!H.wwOn) { H.wwOn = ww; H.wrong.classList.toggle("fr-hide", !ww); if (ww) haptic("heavy"); }
      const finalLap = player.lapsDone === raceLaps - 1 && raceLaps > 1 && state === "racing";
      if (finalLap !== H.finalShown) {
        H.finalShown = finalLap;
        H.lapLabel.innerHTML = finalLap ? `<span style="display:inline-block;width:1.1em;height:.75em;vertical-align:-.05em;background:repeating-conic-gradient(#fff 0 25%,#111 0 50%) 0 0/.375em .375em"></span> FINAL` : "LAP";
        H.lapLabel.style.opacity = finalLap ? "1" : ".7";
      }
      H.timer.textContent = fmtTime(state === "countdown" ? 0 : (player.finished ? player.finishTime : raceTime));
      // delta vs the ghost (time trial) or vs best lap (projected by distance fraction)
      const lapD = player.progress - Math.max(0, player.lapsDone) * TLEN;
      if (raceMode === "tt" && ghost.data && state === "racing" && lapD > 5) {
        const delta = (raceTime - player.lapStart) - ghostTimeAt(lapD);
        H.delta.textContent = "GHOST " + (delta >= 0 ? "+" : "−") + Math.abs(delta / 1000).toFixed(2);
        H.delta.style.color = delta >= 0 ? "#ff5a6a" : "#2ee678";
      } else if (player.bestLap != null && state === "racing" && player.lapsDone >= 0) {
        const frac = clamp((player.progress - player.lapsDone * TLEN) / TLEN, 0, 1);
        const cur = raceTime - player.lapStart;
        const delta = cur - player.bestLap * frac;
        H.delta.textContent = (delta >= 0 ? "+" : "−") + Math.abs(delta / 1000).toFixed(2);
        H.delta.style.color = delta >= 0 ? "#ff5a6a" : "#2ee678";
      } else if (player.slipstream > 0.05 && state === "racing") {
        H.delta.textContent = "SLIPSTREAM"; H.delta.style.color = "#36c8ff";
      } else H.delta.textContent = "";
      // proximity arrows
      let pl = 0, pr = 0;
      const fx = Math.sin(player.h), fz = Math.cos(player.h);
      for (const o of cars) {
        if (o === player || !sameLevel(o, player)) continue;
        const dx = o.x - player.x, dz = o.z - player.z;
        const lon = dx * fx + dz * fz, lat = dx * (-fz) + dz * fx;
        if (lon > -10 && lon < 3 && Math.abs(lat) < 7 && Math.abs(lat) > 1.2) { if (lat < 0) pl = 1; else pr = 1; }
      }
      H.proxL.style.opacity = pl ? "0.95" : "0"; H.proxR.style.opacity = pr ? "0.95" : "0";
      H.brake.classList.toggle("fr-auto", !!player.autoBraking && settings.brakeAssist === "auto");
      H.vignette.style.opacity = clamp((Math.abs(player.u) - 55) / 45, 0, 0.4).toFixed(2);
      updateMinimap();
    }

    function updateMenuCam(dt) {
      menuOrbit += dt * (state === "carSelect" ? 0 : 0.12);
      const b = showcase.base;
      const yaw = state === "carSelect" ? carSelYaw : menuOrbit;
      const r = state === "carSelect" ? 6.4 : 7.8;
      const cx = b.x + Math.sin(b.h + yaw) * r, cz = b.z + Math.cos(b.h + yaw) * r;
      viewCam.position.set(cx, state === "carSelect" ? 2.2 : 1.7, cz);
      // offset the look target so the car sits clear of the menu panel (landscape only)
      const sideX = Math.cos(b.h + yaw), sideZ = -Math.sin(b.h + yaw);
      const off = portrait ? 0 : state === "carSelect" ? 1.7 : -2.1;
      viewCam.lookAt(b.x + sideX * off, 0.55, b.z + sideZ * off);
      setNear(0.3);
      setCamFov(portrait ? 46 : 40);
      showcase.helmet.visible = true;
    }

    function updatePreRaceCam(dt) {
      preRaceT += dt;
      const T = 3.6;
      const t = clamp(preRaceT / T, 0, 1);
      const e = t * t * (3 - 2 * t);
      // sweep from high above the front of the grid into the chase cam's exact pose
      if (preRaceT <= dt) CAM.yaw = player.rh;
      chaseTarget(player, dt, tgt);
      const front = sampleAt(25);
      const startPos = new THREE.Vector3(front.x + front.rx * -14, 26, front.z + front.rz * -14);
      _m4.lookAt(startPos, _look.set(sampleAt(-40).x, 0, sampleAt(-40).z), UP);
      _fromQ.setFromRotationMatrix(_m4);
      _from.copy(startPos).lerp(tgt.pos, e);
      _fromQ.slerp(tgt.quat, e);
      applyCamPose(_from, _fromQ, lerp(58, tgt.fov, e), 0.3);
      camInit = true;
      if (preRaceT > T + 0.3) setState("countdown");
    }

    // shadow-cam basis (fixed sun direction); the follow point is snapped to whole shadow texels
    const sunFwd = SUN_OFFSET.clone().normalize().negate();
    const sunRight = new THREE.Vector3().crossVectors(sunFwd, UP).normalize();
    const sunUp = new THREE.Vector3().crossVectors(sunRight, sunFwd).normalize();
    const texel = 80 / 1024;
    const _sp = new THREE.Vector3();
    function placeSun(x, z) {
      _sp.set(x, 0, z);
      const a = Math.round(_sp.dot(sunRight) / texel) * texel;
      const b = Math.round(_sp.dot(sunUp) / texel) * texel;
      const c = _sp.dot(sunFwd);
      _sp.copy(sunRight).multiplyScalar(a).addScaledVector(sunUp, b).addScaledVector(sunFwd, c);
      sun.target.position.copy(_sp);
      sun.position.copy(_sp).addScaledVector(SUN_OFFSET, 0.5);
    }

    function frame(dtMs) {
      const dt = Math.min(dtMs / 1000, 0.05);
      if (toastT > 0) { toastT -= dt; if (toastT <= 0) toast.classList.add("fr-hide"); }
      if (hintT > 0) { hintT -= dt; if (hintT <= 0) H.hint.classList.add("fr-hide"); }
      if (bannerT > 0) { bannerT -= dt; if (bannerT <= 0) H.banner.style.opacity = "0"; }
      if (warnT > 0) { warnT -= dt; if (warnT <= 0) H.warn.classList.add("fr-hide"); }

      if (state === "menu" || state === "carSelect" || state === "circuitSelect") {
        updateMenuCam(dt);
        if (showcase) {
          showcase.body.rotation.set(0, 0, 0);
        }
      } else if (player) {
        if (!paused) {
          // control sampling once per frame
          if (state === "countdown") {
            countdownT += dt;
            const n = Math.min(5, Math.floor(countdownT));
            if (n !== lightsLit && countdownT < lightsOutAt) {
              lightsLit = n;
              lightEls.forEach((l, i) => l.classList.toggle("lit", i < n));
              setStartLights(n);
              if (n > 0) { audio.blip(660, 0.18, "sine", 0.25); haptic("light"); }
            }
            if (countdownT >= lightsOutAt) {
              lightEls.forEach(l => l.classList.remove("lit"));
              setStartLights(0);
              state = "racing";
              raceTime = 0;
              for (const c of cars) c.lapStart = 0;
              banner("GO!", 1.0, "#2ee678");
              audio.blip(1320, 0.35, "sine", 0.3);
              haptic("success");
              ctx.platform.milestone("lights_out");
              ctx.timeout(() => { if (!disposed) H.lights.classList.add("fr-hide"); }, 900);
            }
          }
          raceAccum += dt * ((TEST && TEST.timeScale) || 1);
          let steps = 0;
          while (raceAccum >= FIXED && steps < 40) {
            if ((state === "racing" || state === "countdown") && !(TEST && TEST.autopilot)) updateControls(FIXED);
            simulate(FIXED);
            raceAccum -= FIXED; steps++;
            if (state === "results") break;
          }
          if (steps >= 40) raceAccum = 0;
          const alpha = clamp(raceAccum / FIXED, 0, 1);
          for (const c of cars) {
            c.rx = lerp(c.px, c.x, alpha); c.rz = lerp(c.pz, c.z, alpha);
            c.rh = c.ph + wrapAngle(c.h - c.ph) * alpha;
            if (track.bridge) carHeight(c);
          }
          if (state === "finished") {
            finishedT += dt;
            if (finishedT > 3.6) setState("results");
          }
          // smoke
          smokeT -= dt;
          if (smokeT <= 0) {
            smokeT = 0.035;
            for (const c of cars) {
              const sl = c.slip + (c.surf >= 2 && Math.abs(c.u) > 12 ? 0.15 : 0);
              if (sl > 0.12 && Math.hypot(c.x - viewCam.position.x, c.z - viewCam.position.z) < 140) {
                const fx = Math.sin(c.h), fz = Math.cos(c.h);
                smoke.emit(c.x - fx * 1.5, c.z - fz * 1.5, c.vx, c.vz, c.ry);
              }
            }
          }
          smoke.update(dt);
          lineColorT -= dt;
          if (lineColorT <= 0) { lineColorT = 0.12; updateGuideColors(); }
          // audio
          if (audio.ready) {
            let nearest = null, nd = 1e9;
            for (const c of cars) { if (c === player) continue; const d = Math.hypot(c.x - player.x, c.z - player.z); if (d < nd) { nd = d; nearest = c; } }
            rivalEngineInfo = nearest ? { f: (nearest.rpm || 6000) / 60 * 1.5 * (1 + clamp((player.u - nearest.u) * 0.004, -0.12, 0.12)), g: clamp(1 - nd / 60, 0, 1) * 0.07 } : null;
            const crowdAmt = clamp(1 - Math.abs(player.progress % TLEN < TLEN / 2 ? player.progress % TLEN : TLEN - player.progress % TLEN) / 260, 0, 1);
            audio.update(player, rivalEngineInfo, crowdAmt);
          }
        }
        if (state === "preRace") updatePreRaceCam(dt);
        else if (state !== "results") updateRaceCam(dt);
        hudT -= dt;
        if (hudT <= 0 && state !== "preRace") { hudT = 0.066; updateHud(dt); }
        for (const c of cars) syncCarVisual(c, dt);
        updateGhost();
      }
      // sun/shadow follows the viewCam focus
      const fxp = player ? { x: player.rx, z: player.rz } : (showcase ? { x: showcase.base.x, z: showcase.base.z } : { x: 0, z: 0 });
      placeSun(fxp.x, fxp.z);
      scene.userData.sky.position.copy(viewCam.position);
      if (!(TEST && TEST.noRender)) {
        renderer.setScissorTest(true);
        const yGL = SH - VR.y - VR.h;
        renderer.setViewport(VR.x, yGL, VR.w, VR.h);
        renderer.setScissor(VR.x, yGL, VR.w, VR.h);
        renderer.render(scene, viewCam);
      }
    }

    // first frame: menu
    loadBar.style.width = "100%";
    updateCircuitTexts();
    layout();
    refreshShowcase();
    setState("menu");
    layoutHud();
    guide.mesh.visible = false;
    try { frame(16); } catch (err) {
      ctx.platform.error({ stage: "first-frame", message: String(err && err.message || err) });
    }
    const loop = ctx.game.loop({ update: (dtMs) => { if (!disposed) frame(dtMs); } });
    ctx.onDestroy(() => { try { loop.destroy(); } catch (e) { /* ignore */ } });
    if (TEST) {
      TEST.api = {
        get state() { return state; }, get player() { return player; }, get cars() { return cars; }, get raceTime() { return raceTime; },
        settings, loadCircuit, get circuit() { return circuit; }, get world() { return world; }, startRace: (mode) => startRaceFlow(false, mode || "race"), skipPre: () => { preRaceT = 99; }, get racing() { return racing; }, get track() { return track; }, PHYS, setState, standings,
        scene, THREE, renderCam: viewCam, controls, toggleCam, placeCarAt, get ghost() { return ghost; }, toggleSteering, get wrongDist() { return wrongDist; }, get camMode() { return camMode; }, get camTrans() { return CAM.trans; },
        get renderInfo() { return Object.assign({}, renderer.info.render, { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures }); }
      };
    }
    ctx.platform.ready();
  }
};
