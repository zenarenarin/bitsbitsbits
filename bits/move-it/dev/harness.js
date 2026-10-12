// Minimal local stand-in for the Plethora runtime `ctx`, covering only the
// SDK surface Move it uses. For local preview and automated tests only; the
// real runtime is provided by Plethora.
(function () {
  const container = document.getElementById("bit");
  const cleanups = [];
  const params = new URLSearchParams(location.search);
  const safe = {
    top: Number(params.get("safeTop") || 0),
    bottom: Number(params.get("safeBottom") || 0),
    left: 0,
    right: 0
  };
  const noStorage = params.has("nostorage");
  const brokenStorage = params.has("brokenstorage");
  const log = (window.__bitLog = []);
  const resizeCbs = [];
  const canvases = [];

  function place(el, opts) {
    const layers = { background: 0, content: 10, overlay: 20, modal: 30 };
    el.style.position = "absolute";
    el.style.inset = "0";
    el.style.zIndex = String(layers[(opts && opts.layer) || "content"] + ((opts && opts.order) || 0));
    if (opts && (opts.input === "passthrough" || opts.pointerEvents === "none")) el.style.pointerEvents = "none";
  }

  function sizeCanvas(c) {
    const w = container.clientWidth, h = container.clientHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, c.__maxDpr || 1);
    c.style.width = w + "px";
    c.style.height = h + "px";
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }

  const ctx = {
    container,
    get width() { return container.clientWidth; },
    get height() { return container.clientHeight; },
    get dpr() { return window.devicePixelRatio || 1; },
    safeArea: safe,
    capabilities: { storage: !noStorage, haptics: true, audio: false },
    runtime: { version: "plethora-bit@2", sdkVersion: "1.6.3", schemaVersion: 1 },
    createCanvas2D(opts) {
      const c = document.createElement("canvas");
      c.__maxDpr = (opts && opts.maxDpr) || 1;
      place(c, opts);
      if (opts && opts.touchAction) c.style.touchAction = opts.touchAction;
      container.appendChild(c);
      sizeCanvas(c);
      canvases.push(c);
      return c;
    },
    createRoot(opts) {
      const d = document.createElement("div");
      place(d, opts);
      if (opts && opts.className) d.className = opts.className;
      container.appendChild(d);
      return d;
    },
    listen(target, ev, fn, opts) {
      target.addEventListener(ev, fn, opts);
      cleanups.push(() => target.removeEventListener(ev, fn, opts));
      return () => target.removeEventListener(ev, fn, opts);
    },
    onResize(cb, opts) {
      resizeCbs.push(cb);
      if (opts && opts.immediate) cb({ width: ctx.width, height: ctx.height, safeArea: safe });
      return () => {};
    },
    timeout(fn, ms) { return setTimeout(fn, ms); },
    interval(fn, ms) { return setInterval(fn, ms); },
    onDestroy(fn) { cleanups.push(fn); },
    markVisualReady() {},
    __testHooks: (window.__testHooks = {}),
    game: {
      loop(o) {
        let last = performance.now();
        let alive = true;
        const tick = (now) => {
          if (!alive) return;
          const dt = now - last;
          last = now;
          if (o.update) o.update(dt, {});
          if (o.render) o.render(1, {});
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        const stop = () => { alive = false; };
        cleanups.push(stop);
        return { stop, destroy: stop };
      }
    },
    storage: {
      get(k) {
        if (brokenStorage) throw new Error("storage broken");
        const v = localStorage.getItem("bit:" + k);
        return v == null ? null : JSON.parse(v);
      },
      set(k, v) {
        if (brokenStorage) throw new Error("storage broken");
        localStorage.setItem("bit:" + k, JSON.stringify(v));
      },
      remove(k) { localStorage.removeItem("bit:" + k); },
      clear() {}
    },
    input: {
      activate(el, fn) {
        const h = (e) => fn(e);
        el.addEventListener("click", h);
        cleanups.push(() => el.removeEventListener("click", h));
        return () => el.removeEventListener("click", h);
      }
    },
    platform: {
      ready() { log.push("ready"); window.__bitReady = true; },
      start() { log.push("start"); },
      interact(p) {
        log.push("interact:" + (p && p.type));
        const hint = document.getElementById("hint");
        if (hint) hint.classList.add("gone");
      },
      haptic(k) { log.push("haptic:" + k); },
      error(p) { log.push("error:" + JSON.stringify(p)); },
      complete() {},
      emit() {}
    }
  };

  window.addEventListener("resize", () => {
    canvases.forEach(sizeCanvas);
    resizeCbs.forEach((cb) => cb({ width: ctx.width, height: ctx.height, safeArea: safe }));
  });
  window.__destroyBit = () => cleanups.splice(0).forEach((f) => f());
  window.__ctx = ctx;

  window.plethoraBit.init(ctx).catch((e) => {
    log.push("init-error:" + e.message);
    console.error(e);
  });
})();
