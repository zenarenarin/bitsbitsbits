// Local stand-in for the Plethora runtime `ctx`, covering only the SDK 1.6.3
// surface the Bits in this repo use. It is a preview harness, not the real
// runtime: the authoritative check is the uploaded draft inside Plethora.
// Tuning overrides come from the query string, e.g. ?view=establishing.
(function () {
  const params = new URLSearchParams(location.search);
  const cleanups = [];
  const frameCbs = [];

  function sizeCanvas(c) {
    const host = c.parentElement;
    const w = host.clientWidth, h = host.clientHeight;
    const scale = c.__maxDpr ? Math.min(window.devicePixelRatio || 1, c.__maxDpr) : 1;
    c.width = Math.round(w * scale);
    c.height = Math.round(h * scale);
  }

  function makeTune(manifest) {
    const knobs = (manifest.tuning && manifest.tuning.knobs) || {};
    const values = {};
    const listeners = [];
    for (const [id, k] of Object.entries(knobs)) {
      let v = k.default;
      if (params.has(id)) {
        const raw = params.get(id);
        v = k.type === "boolean" ? raw === "1" || raw === "true" : k.type === "number" || k.type === "integer" ? Number(raw) : raw;
      }
      values[id] = v;
    }
    const get = (id) => values[id];
    return {
      has: (id) => id in knobs,
      get, number: get, integer: get, boolean: get, choice: get, percent: get, color: get,
      snapshot: () => Object.assign({}, values),
      onChange(ids, fn) {
        listeners.push({ ids: [].concat(ids), fn });
        return () => {};
      },
      __set(id, v) {
        values[id] = v;
        for (const l of listeners) if (l.ids.includes(id)) l.fn(v);
      }
    };
  }

  if (params.has("profile")) globalThis.__dwProfile = [];

  async function boot() {
    const bit = params.get("bit");
    const base = `../../bits/${bit}/`;
    const manifest = await (await fetch(base + "plethora.json")).json();
    const container = document.getElementById("bit");
    window.__bitErrors = [];
    const ctx = {
      container,
      get width() { return container.clientWidth; },
      get height() { return container.clientHeight; },
      get dpr() { return window.devicePixelRatio || 1; },
      get nativeDpr() { return window.devicePixelRatio || 1; },
      safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
      manifest,
      runtime: { version: "plethora-bit@2", sdkVersion: "1.6.3", schemaVersion: 1 },
      capabilities: {},
      createCanvas2D(opts) {
        const c = document.createElement("canvas");
        c.__maxDpr = opts && opts.maxDpr;
        c.style.cssText = "position:absolute;inset:0;width:100%;height:100%;";
        container.appendChild(c);
        sizeCanvas(c);
        return c;
      },
      createRoot() {
        const d = document.createElement("div");
        d.style.cssText = "position:absolute;inset:0;";
        container.appendChild(d);
        return d;
      },
      onResize(cb, opts) {
        const fn = () => {
          container.querySelectorAll("canvas").forEach(sizeCanvas);
          cb({ width: ctx.width, height: ctx.height, dpr: ctx.dpr, nativeDpr: ctx.dpr, safeArea: ctx.safeArea });
        };
        window.addEventListener("resize", fn);
        if (opts && opts.immediate) fn();
        return () => window.removeEventListener("resize", fn);
      },
      onDestroy(fn) { cleanups.push(fn); },
      listen(target, ev, fn, o) {
        target.addEventListener(ev, fn, o);
        return () => target.removeEventListener(ev, fn, o);
      },
      onFrame(fn) { frameCbs.push(fn); },
      game: {
        // Minimal stand-in for ctx.game.loop: fixed-step update plus render.
        loop(o) {
          const stepMs = o.fixedHz ? 1000 / o.fixedHz : 0;
          let acc = 0, last = performance.now(), running = true;
          const tick = (now) => {
            if (!running) return;
            const dt = Math.min(now - last, o.maxDeltaMs || 250);
            last = now;
            if (o.update) o.update(dt, {});
            if (o.fixedUpdate && stepMs) {
              acc += dt;
              let n = 0;
              while (acc >= stepMs && n < (o.maxSubsteps || 8)) { o.fixedUpdate(stepMs, {}); acc -= stepMs; n++; }
              if (n >= (o.maxSubsteps || 8)) acc = 0;
            }
            if (o.render) o.render(stepMs ? acc / stepMs : 1, {});
            window.__frames = (window.__frames || 0) + 1;
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
          const h = { pause() { running = false; }, resume() { if (!running) { running = true; last = performance.now(); requestAnimationFrame(tick); } }, stop() { running = false; }, destroy() { running = false; } };
          cleanups.push(() => h.stop());
          return h;
        }
      },
      markVisualReady(reason) { window.__bitVisualReady = reason || true; },
      platform: {
        ready() { window.__bitReady = true; },
        start() {}, interact() {}, milestone() {}, complete() {}, fail() {}, emit() {},
        error(p) { window.__bitErrors.push(p); console.error("platform.error", JSON.stringify(p)); }
      },
      tune: makeTune(manifest)
    };
    window.__ctx = ctx;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = base + manifest.entry + "?t=" + Date.now();
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
    const t0 = performance.now();
    await window.plethoraBit.init(ctx);
    window.__bitInitMs = performance.now() - t0;
    let last = performance.now();
    const tick = (t) => {
      for (const fn of frameCbs) fn(t - last, t);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  boot().catch((e) => {
    window.__bitErrors = window.__bitErrors || [];
    window.__bitErrors.push({ stage: "harness", message: String(e && e.stack || e) });
    console.error(e);
  });
})();
