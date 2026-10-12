#!/usr/bin/env node
// Plays a Bit in headless Chromium with a scripted keyboard sequence, saving
// screenshots and reporting frame rate and (for Beast) the explorer
// state, so movement can be checked in the real renderer.
//   NODE_PATH=$(npm root -g) node tools/preview/play.cjs --bit beast \
//     --out dir --script "hold:ArrowLeft:3000,tap:Space,wait:800,shot" [knob=value ...]
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const opt = { width: 390, height: 844, dpr: 2 };
const knobs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) opt[args[i].slice(2)] = args[++i];
  else knobs.push(args[i]);
}
const root = path.resolve(__dirname, "..", "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

server.listen(0, async () => {
  const browser = await chromium.launch();
  let code = 0;
  try {
    fs.mkdirSync(opt.out, { recursive: true });
    const page = await browser.newPage({ viewport: { width: +opt.width, height: +opt.height }, deviceScaleFactor: +opt.dpr });
    page.on("pageerror", (e) => { console.log(`[pageerror] ${e.message}`); code = 2; });
    page.on("console", (m) => { if (m.type() === "error") console.log(`[console.error] ${m.text()}`); });
    const q = new URLSearchParams({ bit: opt.bit, profile: "1" });
    for (const kv of knobs) { const [k, v] = kv.split("="); q.set(k, v); }
    await page.goto(`http://127.0.0.1:${server.address().port}/tools/preview/index.html?${q}`);
    await page.waitForFunction(() => window.__bitReady || (window.__bitErrors && window.__bitErrors.length), null, { timeout: 120000 });
    const state = () => page.evaluate(() => ({ s: globalThis.__dwState, frames: window.__frames || 0, t: performance.now(), perf: globalThis.__dwPerf }));
    let shot = 0;
    const log = async (label) => {
      const s = await state();
      const st = s.s || {};
      console.log(`${label.padEnd(18)} x=${(st.x ?? 0).toFixed(2)} y=${(st.y ?? 0).toFixed(2)} ${st.state} grounded=${st.grounded} feetSd=${(st.feetSd ?? 0).toFixed(3)} pending=${st.pending}${st.alertState ? ` beast=${st.alertState} ${st.alert.toFixed(2)}` : ""}${st.seeds !== undefined ? ` seeds=${st.seeds} quiet=${st.quiet.toFixed(1)}m/t${st.quietTier} remembered=${st.remembered}${st.results ? " RESULTS" : ""}${st.journal ? " JOURNAL" : ""}` : ""}`);
      return s;
    };
    let last = await log("start");
    for (const step of (opt.script || "").split(",").filter(Boolean)) {
      const [cmd, a, b] = step.split(":");
      if (cmd === "hold") { await page.keyboard.down(a); await page.waitForTimeout(+b); await page.keyboard.up(a); }
      else if (cmd === "holdrun") { await page.keyboard.down("Shift"); await page.keyboard.down(a); await page.waitForTimeout(+b); await page.keyboard.up(a); await page.keyboard.up("Shift"); }
      else if (cmd === "tap") { await page.keyboard.press(a); }
      // Touch-style pointer input (CSS px): press-and-hold, and a quick swipe up.
      else if (cmd === "press") { const [x, y] = a.split("/").map(Number); await page.mouse.move(x, y); await page.mouse.down(); await page.waitForTimeout(+b); await page.mouse.up(); }
      else if (cmd === "swipe") { const [x, y] = a.split("/").map(Number); await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x, y - 30, { steps: 2 }); await page.mouse.move(x, y - 70, { steps: 2 }); await page.mouse.up(); }
      else if (cmd === "wait") { await page.waitForTimeout(+a); }
      else if (cmd === "alert") { await page.evaluate((v) => { globalThis.__dwAlert.level = v; }, +a); }
      // Beast interface hooks: open/close the journal, wake the beast, move the explorer.
      else if (cmd === "journal") { await page.evaluate((v) => globalThis.__dwGame.openJournal(v !== "off"), a); }
      else if (cmd === "remember") { await page.evaluate((ids) => { for (const id of ids.split("+")) globalThis.__dwGame.memory.discover(id); }, a); }
      else if (cmd === "wake") { await page.evaluate(() => globalThis.__dwGame.wake()); }
      else if (cmd === "tp") { const [x, y] = a.split("/").map(Number); await page.evaluate(([x2, y2]) => globalThis.__dwGame.ex.reset({ x: x2, y: y2, facing: -1 }), [x, y]); }
      else if (cmd === "click") { const [x, y] = a.split("/").map(Number); await page.mouse.click(x, y); }
      else if (cmd === "shot") { const f = path.join(opt.out, `shot-${String(++shot).padStart(2, "0")}.png`); await page.screenshot({ path: f }); }
      const s = await log(step);
      const fps = ((s.frames - last.frames) * 1000) / Math.max(1, s.t - last.t);
      if (cmd === "hold" || cmd === "holdrun" || cmd === "wait") console.log(`${"".padEnd(18)} fps over step: ${fps.toFixed(1)}`);
      last = s;
    }
    const p = (await state()).perf;
    const st = (await state()).s || {};
    console.log(`synchronous must-show paints: ${st.syncCount} taking ${(st.syncMs || 0).toFixed(0)} ms total`);
    const parts = await page.evaluate(() => globalThis.__dwParts);
    if (p && parts) console.log('per-part ms/frame: ' + Object.entries(parts).map(([k2, v]) => `${k2}=${(v / p.n).toFixed(2)}`).join(' '));
    if (p) console.log(`per-frame JS: draw avg ${(p.draw / p.n).toFixed(1)} ms (max ${p.maxDraw.toFixed(1)}), paint avg ${(p.pump / p.n).toFixed(1)} ms (max ${p.maxPump.toFixed(1)}) over ${p.n} frames; spikes ${JSON.stringify(p.spikes || [])}`);
  } catch (e) {
    console.error(e);
    code = 1;
  } finally {
    await browser.close();
    server.close();
    process.exit(code);
  }
});
