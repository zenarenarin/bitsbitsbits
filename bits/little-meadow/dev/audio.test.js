// Records what the game actually outputs during real-time play (headless Chromium) and logs the
// audio engine's state at each step: start, cutting, turning, collisions, pause, game over, restart, mute.
// usage: node dev/audio.test.js  -> out/soundscape.webm (+ wav), console report
const path = require("path"), fs = require("fs");
const { chromium } = require(process.env.PW || "playwright");
const OUT = path.join(__dirname, "out"); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await (process.env.CHROME ? chromium.launch({ executablePath: process.env.CHROME, args: ["--autoplay-policy=no-user-gesture-required"] }) : chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] }));
  const page = await browser.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 1 });
  const errors = []; page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("file://" + path.join(__dirname, "harness.html"));
  await page.waitForFunction(() => window.__LM_GAME__);
  const snap = async (label) => { const d = await page.evaluate(() => ({ a: __LM_GAME__.sound.debug(), phase: __LM_GAME__.phase, terrain: __LM_GAME__.sim.s.terrain, cutRate: +__LM_GAME__.sim.s.cutRate.toFixed(1) })); console.log(label.padEnd(26), JSON.stringify(d)); return d; };
  await page.evaluate(() => {
    __LM_GAME__.beginPlay();
    const tap = __LM_GAME__.sound.tap;
    window.__chunks = [];
    window.__rec = new MediaRecorder(tap.stream, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 160000 });
    __rec.ondataavailable = (e) => __chunks.push(e.data);
    __rec.start(500);
    // autopilot that also respects rabbits and rocks
    const C = __LM_CORE__, G = __LM_GAME__;
    window.__pilot = setInterval(() => {
      const sim = G.sim, s = sim.s; if (G.phase !== "play" || s.change || window.__noPilot) return;
      const r0 = Math.floor(s.y + 0.15), H = 9, V = [];
      const blocked = new Set(sim.rabbits.filter((r) => !r.fled).map((r) => Math.floor(r.hop ? r.hop.y1 : r.y) + ":" + Math.floor(r.hop ? r.hop.x1 : r.x)));
      for (let k = H; k >= 0; k--) { const row = sim.gen.row(r0 + k); V[k] = []; for (let l = 0; l < 7; l++) { const c = row.cells[l]; if (c.f || c.t === C.CELL_OBST || blocked.has((r0 + k) + ":" + l)) { V[k][l] = -1e6; continue; } let v = 0; for (const t of row.tufts) if (!t.cut && Math.abs(t.x - l - 0.5) < 0.46) v += t.v; let b = k === H ? 0 : -1e6; if (k < H) for (let d = -1; d <= 1; d++) { const l2 = l + d; if (l2 >= 0 && l2 < 7) b = Math.max(b, V[k + 1][l2] - (d ? 0.4 : 0)); } V[k][l] = v + b; } }
      const k = Math.max(1, Math.floor(s.y + 1.2) - r0); let bl = s.lane, bv = -1e9;
      for (let d = -1; d <= 1; d++) { const l = s.lane + d; if (l >= 0 && l < 7 && V[k][l] - (d ? 0.6 : 0) > bv) { bv = V[k][l] - (d ? 0.6 : 0); bl = l; } }
      if (bl !== s.lane) G.steer(bl > s.lane ? 1 : -1);
    }, 80);
  });
  const timeline = [];
  const t0 = Date.now(), mark = (label) => timeline.push([((Date.now() - t0) / 1000).toFixed(1), label]);
  mark("start: engine up, mowing");
  await page.waitForTimeout(2500); await snap("mowing");
  let maxVoices = 0;
  for (let i = 0; i < 24; i++) { await page.waitForTimeout(1000); const d = await page.evaluate(() => __LM_GAME__.sound.debug()); maxVoices = Math.max(maxVoices, d.voices); }
  await snap("after 26 s of play");
  mark("pause"); await page.evaluate(() => __LM_GAME__.togglePause()); await page.waitForTimeout(2500); await snap("paused");
  mark("resume"); await page.evaluate(() => __LM_GAME__.togglePause()); await page.waitForTimeout(3000); await snap("resumed");
  mark("hands off: collisions until the run ends"); await page.evaluate(() => { window.__noPilot = true; });
  for (let i = 0; i < 90; i++) { await page.waitForTimeout(250); if (await page.evaluate(() => __LM_GAME__.phase === "over")) break; }
  mark("game over"); await page.waitForTimeout(600); await snap("just after game over"); await page.waitForTimeout(3000); await snap("resting on results");
  mark("restart"); await page.evaluate(() => { window.__noPilot = false; __LM_GAME__.restart(); }); await page.waitForTimeout(4000); await snap("restarted (no duplicate loops)");
  mark("mute effects"); await page.evaluate(() => { const s = __LM_GAME__.sound; s.setMix({ sfx: false }); }); await page.waitForTimeout(2000); await snap("effects muted");
  mark("unmute"); await page.evaluate(() => __LM_GAME__.sound.setMix({ sfx: true })); await page.waitForTimeout(2000);
  const b64 = await page.evaluate(() => new Promise((res) => { __rec.onstop = async () => { const blob = new Blob(__chunks, { type: "audio/webm" }); const buf = new Uint8Array(await blob.arrayBuffer()); let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000)); res(btoa(s)); }; __rec.stop(); }));
  fs.writeFileSync(path.join(OUT, "soundscape.webm"), Buffer.from(b64, "base64"));
  fs.writeFileSync(path.join(OUT, "soundscape-timeline.txt"), timeline.map((t) => t.join("  ")).join("\n") + "\n");
  console.log("max simultaneous one-shot voices:", maxVoices);
  console.log("timeline:", JSON.stringify(timeline));
  console.log("errors:", JSON.stringify(errors));
  await browser.close();
})();
