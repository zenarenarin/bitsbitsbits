// Minimal local stand-in for the Plethora runtime (plethora-bit@2), covering
// only the ctx surface COPYCAT uses, so the Bit can be played and tested in a
// desktop or phone browser. The real runtime is provided by Plethora.
(function () {
  function createMockCtx(container, manifest, opts) {
    const cleanups = [];
    const params = new URLSearchParams(location.search);
    const safeArea = {
      top: +(params.get("safeTop") || 0), bottom: +(params.get("safeBottom") || 0),
      left: +(params.get("safeLeft") || 0), right: +(params.get("safeRight") || 0)
    };
    const events = (window.__events = []);
    const log = (type, payload) => { events.push({ type, payload, t: performance.now() }); };
    const canvases = [];
    const resizeCbs = [];
    function sizeCanvas(c) {
      const w = container.clientWidth, h = container.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, c._maxDpr || 1);
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      c.style.width = w + "px"; c.style.height = h + "px";
      if (c._css) c.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function tuneDefaults() {
      const out = {}, curves = {};
      const t = manifest.tuning || {};
      for (const k in t.knobs || {}) out[k] = t.knobs[k].default;
      for (const k in t.curves || {}) curves[k] = t.curves[k].default;
      return { out, curves };
    }
    const td = tuneDefaults();
    const store = {
      get(k) { try { const v = localStorage.getItem("mock." + k); return v === null ? null : JSON.parse(v); } catch (e) { return null; } },
      set(k, v) { try { localStorage.setItem("mock." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
      remove(k) { try { localStorage.removeItem("mock." + k); } catch (e) { /* ignore */ } },
      clear() { /* not needed */ }
    };
    const ctx = {
      container,
      get width() { return container.clientWidth; },
      get height() { return container.clientHeight; },
      get dpr() { return window.devicePixelRatio || 1; },
      get nativeDpr() { return window.devicePixelRatio || 1; },
      safeArea,
      manifest,
      runtime: { version: "plethora-bit@2", sdkVersion: "1.6.3-mock", schemaVersion: 1 },
      capabilities: { audio: true, backgroundMusic: false, camera: false, haptics: true, microphone: false, motion: false, storage: !opts.noStorage },
      createCanvas2D(o) {
        o = o || {};
        const c = document.createElement("canvas");
        c.style.position = "absolute"; c.style.left = "0"; c.style.top = "0";
        c.style.touchAction = o.touchAction || "none";
        c._maxDpr = o.maxDpr || 1; c._css = o.coordinateSpace === "css";
        container.appendChild(c);
        canvases.push(c);
        sizeCanvas(c);
        return c;
      },
      input: {
        track(target) {
          const st = { down: false, pressed: false, released: false, frameDone() { st.pressed = st.released = false; } };
          const d = () => { st.down = true; st.pressed = true; }, u = () => { st.down = false; st.released = true; };
          target.addEventListener("pointerdown", d); target.addEventListener("pointerup", u);
          cleanups.push(() => { target.removeEventListener("pointerdown", d); target.removeEventListener("pointerup", u); });
          return st;
        }
      },
      listen(target, ev, fn, o) { target.addEventListener(ev, fn, o); cleanups.push(() => target.removeEventListener(ev, fn, o)); return () => target.removeEventListener(ev, fn, o); },
      onResize(cb, o) {
        resizeCbs.push(cb);
        if (o && o.immediate) cb({ width: ctx.width, height: ctx.height, dpr: ctx.dpr, safeArea });
        return () => {};
      },
      onDestroy(fn) { cleanups.push(fn); },
      timeout(fn, ms) { const id = setTimeout(fn, ms); cleanups.push(() => clearTimeout(id)); return id; },
      tune: {
        has(id) { return id in td.out || id in td.curves; },
        get(id) { return td.out[id]; },
        curve(id) {
          const pts = td.curves[id];
          return { at(x) { for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (x <= b.x) return a.y + (b.y - a.y) * Math.max(0, (x - a.x) / (b.x - a.x)); } return pts[pts.length - 1].y; } };
        },
        onChange() { return () => {}; }
      },
      storage: store,
      game: {
        score(o) {
          let value = (o && o.initial) || 0;
          return {
            get value() { return value; },
            set(v) { value = v; window.__score = v; },
            add(v) { value += v; },
            reset() { value = 0; },
            submit(ch, meta) { log("record.submit", { ch, value, meta }); return Promise.resolve({ accepted: true }); }
          };
        },
        loop(o) {
          let last = performance.now(), acc = 0, raf = 0, stopped = false;
          const step = 1000 / (o.fixedHz || 60);
          const frame = (now) => {
            if (stopped) return;
            // window.__manualDt (ms) drives a deterministic clock for recordings
            let dt = window.__manualDt !== undefined ? window.__manualDt : Math.min(o.maxDeltaMs || 100, now - last);
            last = now;
            const scale = window.__timeScale || 1;
            dt *= scale;
            if (o.update) o.update(dt, {});
            acc += dt;
            let n = 0;
            while (acc >= step && n < (o.maxSubsteps || 8)) { if (o.fixedUpdate) o.fixedUpdate(step, {}); acc -= step; n++; }
            if (n >= (o.maxSubsteps || 8)) acc = 0;
            if (o.render) o.render(acc / step, {});
            if (o.input && o.input.frameDone) o.input.frameDone();
            raf = requestAnimationFrame(frame);
          };
          raf = requestAnimationFrame(frame);
          const ctl = { stop() { stopped = true; cancelAnimationFrame(raf); }, pause() { stopped = true; }, resume() { if (stopped) { stopped = false; last = performance.now(); raf = requestAnimationFrame(frame); } } };
          cleanups.push(ctl.stop);
          window.__loop = ctl;
          return ctl;
        }
      },
      platform: {
        ready(p) { log("ready", p); }, start(p) { log("start", p); }, interact(p) { log("interact", p); },
        fail(p) { log("fail", p); }, milestone(n, p) { log("milestone", { n, p }); }, error(p) { log("error", p); },
        complete(p) { log("complete", p); }, haptic(k) { log("haptic", k); }, emit(n, p) { log("emit", { n, p }); }
      },
      pulse: { complete(p) { log("pulse", p); } },
      loadFont() { return Promise.reject(new Error("fonts unavailable in mock")); },
      _destroy() { while (cleanups.length) { try { cleanups.pop()(); } catch (e) { console.error(e); } } }
    };
    window.addEventListener("resize", () => {
      for (const c of canvases) sizeCanvas(c);
      for (const cb of resizeCbs) cb({ width: ctx.width, height: ctx.height, dpr: ctx.dpr, safeArea });
    });
    return ctx;
  }
  window.createMockCtx = createMockCtx;
})();
