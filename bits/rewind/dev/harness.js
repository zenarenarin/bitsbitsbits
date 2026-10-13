// Minimal local stand-in for the Plethora plethora-bit@2 runtime, for development and
// automated play-testing only. It implements the subset of ctx that REWIND uses.
// Query params: ?w=390&h=844 sets the stage size (defaults to the window), ?debug=1 exposes hooks.
(function () {
  const params = new URLSearchParams(location.search);
  const REGISTRY = {
    "three@0.164.1": "https://libs.plethora.studio/three/0.164.1/three.module.js"
  };
  const FONTS = {
    "cormorant-garamond@1.0.0:300:normal": "https://libs.plethora.studio/fonts/cormorant-garamond/1.0.0/300.ttf",
    "cormorant-garamond@1.0.0:300:italic": "https://libs.plethora.studio/fonts/cormorant-garamond/1.0.0/300-italic.ttf",
    "inter@1.0.0:400:normal": "https://libs.plethora.studio/fonts/inter/1.0.0/400.ttf",
    "inter@1.0.0:600:normal": "https://libs.plethora.studio/fonts/inter/1.0.0/600.ttf"
  };
  const logEl = () => document.getElementById("log");
  const events = [];
  function log(name, payload) {
    events.push({ name, payload, t: performance.now() });
    const el = logEl();
    if (el) el.textContent = events.slice(-6).map(e => e.name + " " + (e.payload ? JSON.stringify(e.payload) : "")).join("\n");
  }
  window.__harnessEvents = events;

  window.__bootHarness = async function () {
    const stage = document.getElementById("stage");
    const W = parseInt(params.get("w") || window.innerWidth, 10);
    const H = parseInt(params.get("h") || window.innerHeight, 10);
    stage.style.width = W + "px";
    stage.style.height = H + "px";
    const cleanups = [];
    const frameCbs = [];
    const resizeCbs = [];
    const store = {};
    const ctx = {
      container: stage,
      width: W, height: H,
      dpr: Math.min(window.devicePixelRatio || 1, 2), nativeDpr: window.devicePixelRatio || 1,
      safeArea: { top: 0, bottom: parseInt(params.get("sb") || "24", 10), left: 0, right: 0 },
      capabilities: { audio: true, backgroundMusic: true, haptics: true, storage: true, camera: false, microphone: false, motion: false },
      runtime: { version: "plethora-bit@2", sdkVersion: "1.6.4", schemaVersion: 1 },
      manifest: {},
      debugHooks: params.get("debug") ? (window.__rewindDebug = {}) : undefined,
      createRoot(opts = {}) {
        const el = document.createElement("div");
        el.style.cssText = "position:absolute;inset:0;";
        if (opts.style && typeof opts.style === "string") el.style.cssText += opts.style;
        if (opts.input === "passthrough" || opts.pointerEvents === "none") el.style.pointerEvents = "none";
        el.style.zIndex = opts.zIndex != null ? opts.zIndex : ({ background: 0, content: 1, overlay: 10, modal: 20 }[opts.layer] || 5);
        stage.appendChild(el);
        return el;
      },
      createCanvas(opts = {}) {
        const c = document.createElement("canvas");
        c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:" + (opts.touchAction || "auto");
        c.style.zIndex = opts.zIndex != null ? opts.zIndex : ({ background: 0, content: 1, overlay: 10, modal: 20 }[opts.layer] || 5);
        stage.appendChild(c);
        return c;
      },
      listen(target, name, fn, options) {
        target.addEventListener(name, fn, options);
        cleanups.push(() => target.removeEventListener(name, fn, options));
        return () => target.removeEventListener(name, fn, options);
      },
      onFrame(cb) { frameCbs.push(cb); },
      onResize(cb, opts = {}) {
        resizeCbs.push(cb);
        if (opts.immediate) cb({ width: ctx.width, height: ctx.height, dpr: ctx.dpr, nativeDpr: ctx.nativeDpr, safeArea: ctx.safeArea });
        return () => {};
      },
      timeout(fn, ms) { const id = setTimeout(fn, ms); return () => clearTimeout(id); },
      interval(fn, ms) { const id = setInterval(fn, ms); return () => clearInterval(id); },
      onDestroy(fn) { cleanups.push(fn); },
      markVisualReady(r) { log("markVisualReady", r); },
      async importModule(name, version) {
        const url = REGISTRY[name + "@" + version];
        if (!url) throw new Error("undeclared module " + name + "@" + version);
        return import(url);
      },
      async loadFont(family, name, version, opts = {}) {
        const key = name + "@" + version + ":" + (opts.weight || "400") + ":" + (opts.style || "normal");
        const url = FONTS[key];
        if (!url) throw new Error("unknown font " + key);
        const face = new FontFace(family, "url(" + url + ")", { weight: opts.weight, style: opts.style });
        await face.load();
        document.fonts.add(face);
        return face;
      },
      storage: {
        get(k) { try { const v = localStorage.getItem("rewind:" + k); return v == null ? null : JSON.parse(v); } catch (e) { return null; } },
        set(k, v) { try { localStorage.setItem("rewind:" + k, JSON.stringify(v)); } catch (e) {} },
        remove(k) { try { localStorage.removeItem("rewind:" + k); } catch (e) {} },
        clear() {}
      },
      platform: {
        ready(p) { log("ready", p); },
        start(p) { log("start", p); },
        interact(p) { if (p && p.type !== "steer") log("interact", p); },
        setScore(s) {},
        setProgress() {},
        milestone(n, p) { log("milestone", n); },
        complete(p) { log("complete", p); },
        fail(p) { log("fail", p); },
        error(p) { log("error", p); console.error("platform.error", p); },
        emit(n, p) { log("emit:" + n, p); },
        haptic(k) {}
      },
      memory: {
        record(id) {
          return {
            async submit(v, o) { log("record.submit", { id, v }); return { accepted: true }; },
            async checkpoint(v) { return { queued: true }; }
          };
        }
      },
      game: {
        loop(opts) {
          const fixedMs = opts.fixedHz ? 1000 / opts.fixedHz : 0;
          let acc = 0, last = performance.now(), running = opts.autoStart !== false, frame = 0;
          const maxDelta = opts.maxDeltaMs || 100;
          const state = { timeMs: 0, dtMs: 0, frame: 0 };
          let manual = !!params.get("manualclock");
          const tick = (now, forcedDt) => {
            let dt = forcedDt != null ? forcedDt : Math.min(now - last, maxDelta);
            last = now;
            if (!running) return;
            state.dtMs = dt; state.timeMs += dt; state.frame = ++frame;
            if (opts.update) opts.update(dt, state);
            let alpha = 1;
            if (fixedMs) {
              acc += dt;
              let n = 0;
              while (acc >= fixedMs && n < (opts.maxSubsteps || 12)) { opts.fixedUpdate(fixedMs, state); acc -= fixedMs; n++; }
              if (n >= (opts.maxSubsteps || 12)) acc = 0;
              alpha = acc / fixedMs;
            }
            if (opts.render) opts.render(alpha, state);
          };
          const raf = (now) => { if (!manual) tick(now); requestAnimationFrame(raf); };
          requestAnimationFrame(raf);
          const handle = {
            pause() { running = false; }, resume() { running = true; last = performance.now(); },
            stop() { running = false; }, destroy() { running = false; },
            step(ms) { const was = running; running = true; tick(performance.now(), ms || fixedMs || 16.67); running = was; },
            setManual(v) { manual = v; last = performance.now(); }
          };
          window.__loop = handle;
          return handle;
        },
        score() {
          const t = { value: 0, set(v) { t.value = v; }, add(v) { t.value += v; }, reset() { t.value = 0; }, flush() {},
            async submit(id) { log("score.submit", { id, v: t.value }); return { accepted: true, isPersonalBest: false }; } };
          return t;
        }
      }
    };
    window.__ctx = ctx;
    try {
      await window.plethoraBit.init(ctx);
    } catch (e) {
      console.error(e);
      log("init error", String(e && e.stack || e));
    }
  };
})();
