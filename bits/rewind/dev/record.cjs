// Records a gameplay video of REWIND from the local harness: the autopilot plays, every frame is
// rendered deterministically (SPEED x real time) and captured with the DOM HUD, then encoded.
// Usage: NODE_PATH=$(npm root -g) VENDOR=<mirror> node dev/record.cjs <outDir> [seed]
// Env: SECONDS_VIDEO (30), SPEED (2), FPS (30). Needs: npx http-server -p 8123 bits/rewind
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
const outDir = process.argv[2] || "rec"; const seed = parseInt(process.argv[3] || "15", 10);
const VIDEO_S = parseFloat(process.env.SECONDS_VIDEO || "30"), SPEED = parseFloat(process.env.SPEED || "2"), FPS = parseInt(process.env.FPS || "30", 10);
const TITLE_S = 1.6, END_S = 1.6;
const VENDOR = process.env.VENDOR;
(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
  const page = await browser.newPage({ viewport: { width: 405, height: 720 }, deviceScaleFactor: 2, hasTouch: true });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  if (VENDOR) await page.route("https://libs.plethora.studio/**", async (route) => {
    const u = new URL(route.request().url());
    const local = path.join(VENDOR, u.pathname.replace(/^\/three\/0\.164\.1\//, "").replace(/^\//, ""));
    if (fs.existsSync(local)) return route.fulfill({ status: 200, body: fs.readFileSync(local), headers: { "content-type": local.endsWith(".js") ? "text/javascript" : "font/ttf", "access-control-allow-origin": "*" } });
    return route.abort();
  });
  await page.goto("http://localhost:8123/dev/index.html?debug=1&manualclock=1&w=405&h=720");
  await page.waitForFunction(() => window.__rewindDebug && window.__rewindDebug.run, null, { timeout: 60000 });
  await page.evaluate(() => document.fonts && document.fonts.ready);
  await require(path.join(__dirname, "scenarios.cjs")).installAutopilot(page);
  // presentation: hide dev overlays; drive toasts by game time instead of wall time
  await page.evaluate(() => {
    const d = window.__rewindDebug;
    if (window.__loop.setManual) window.__loop.setManual(true);
    const st = document.createElement("style");
    st.textContent = "#log{display:none!important}#rw-diag{display:none!important}.rw-toasts{visibility:hidden}";
    document.head.appendChild(st);
    d.input.usedTouch = true;
    const host = d.hud.toasts.cloneNode(false); host.id = "rec-toasts"; host.style.visibility = "visible";
    d.hud.toasts.parentNode.appendChild(host);
    const live = [];
    new MutationObserver((ms) => { for (const m of ms) for (const n of m.addedNodes) { const c = n.cloneNode(true); c.style.animation = "none"; host.appendChild(c); live.push({ el: c, t: d.run.time }); } }).observe(d.hud.toasts, { childList: true });
    window.__recToasts = () => {
      host.style.top = d.hud.toasts.style.top;
      for (let i = live.length - 1; i >= 0; i--) {
        const a = (d.run.time - live[i].t) / 1.6;
        if (a >= 1) { live[i].el.remove(); live.splice(i, 1); continue; }
        const op = a < 0.12 ? a / 0.12 : a > 0.75 ? (1 - a) / 0.25 : 1;
        live[i].el.style.opacity = op; live[i].el.style.transform = "translateY(" + (a < 0.12 ? 6 * (1 - a / 0.12) : a > 0.75 ? -10 * (a - 0.75) / 0.25 : 0) + "px)";
      }
    };
  });
  const stepsPerFrame = Math.round((120 * SPEED) / FPS), dt = stepsPerFrame / 120;
  let frame = 0;
  const shot = async () => { await page.screenshot({ path: path.join(outDir, String(frame++).padStart(5, "0") + ".png"), timeout: 120000 }); };
  const advance = (mode) => page.evaluate(([n, dt, mode]) => {
    const d = window.__rewindDebug;
    let v = null;
    // the opening is played like a person would: walk up, watch the bridge fall, then hold
    // rewind and walk across as it rebuilds. The autopilot takes over after the bridge.
    const span = d.course.segs.find((sg) => sg.kind === "intro1");
    const spanEl = span && span.elements.find((e) => e.type === "span");
    for (let i = 0; i < n; i++) {
      d.course.ensure(d.player.s + 120);
      if (mode === "play") {
        if (spanEl && d.player.s < spanEl.s1 + 0.6) {
          window.__recPhase = window.__recPhase || "walk";
          if (window.__recPhase === "walk" && d.clock.T > 2.7) window.__recPhase = "rewind";
          v = window.__recPhase === "walk" ? { mx: 0, my: d.player.s < spanEl.s0 - 1.1 ? 1 : 0 } : { mx: 0, my: 1, rew: true };
          d.input.virtual = v;
        } else v = d.autopilot.decide();
      }
      d.fixedStep();
    }
    if (v) {
      d.hud.trev.classList.toggle("down", !!v.rew); d.hud.tfwd.classList.toggle("down", !!v.ff && !v.rew);
      // show the left-thumb stick following the movement input
      const L = d.hud.layout, m = Math.hypot(v.mx || 0, v.my || 0);
      d.hud.stick.style.display = m > 0.05 ? "block" : "none";
      d.hud.padhint.style.opacity = m > 0.05 ? "0" : "1";
      d.hud.stick.style.left = "78px"; d.hud.stick.style.top = (L.by + L.B / 2) + "px";
      d.hud.knob.style.transform = "translate(" + ((v.mx || 0) * 50).toFixed(1) + "px," + (-(v.my || 0) * 50).toFixed(1) + "px)";
    }
    d.renderAt(dt); window.__recToasts();
    return { state: d.run.state, s: d.player.s, T: d.clock.T, score: d.run.score };
  }, [stepsPerFrame, dt, mode]);
  const titleFrames = Math.round(TITLE_S * FPS), endFrames = Math.round(END_S * FPS), playFrames = Math.round(VIDEO_S * FPS) - titleFrames - endFrames;
  const t0 = Date.now();
  for (let i = 0; i < titleFrames; i++) { await advance("title"); await shot(); }
  await page.evaluate((seed) => { const d = window.__rewindDebug; d.startRun(seed); d.hud.touch.classList.add("on"); }, seed);
  let last;
  for (let i = 0; i < playFrames; i++) {
    last = await advance("play"); await shot();
    if (i % 60 === 0) console.log("frame", frame, JSON.stringify(last), ((Date.now() - t0) / 1000).toFixed(0) + "s");
    if (last.state !== "play") break;
  }
  // end card: the title over the living world
  await page.evaluate(() => { const d = window.__rewindDebug; d.input.virtual = null; d.setState("title"); });
  while (frame < Math.round(VIDEO_S * FPS)) { await advance("title"); await shot(); }
  console.log("done", frame, "frames", ((Date.now() - t0) / 1000).toFixed(0) + "s", JSON.stringify(last));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
