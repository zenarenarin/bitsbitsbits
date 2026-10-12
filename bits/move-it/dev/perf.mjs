// Rough per-frame cost of animation + rendering (playback with both figures).
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 });
await page.goto("file://" + path.join(here, "index.html"));
if (process.env.PROJ) await page.evaluate((p) => localStorage.setItem("bit:move-it-project", p), process.env.PROJ);
await page.goto("file://" + path.join(here, "index.html"));
await page.waitForFunction(() => window.__bitReady);
const ms = await page.evaluate(() => {
  const h = window.__testHooks.moveIt;
  const t0 = performance.now();
  for (let i = 1; i <= 120; i++) h.showAt(i / 60, 60);
  // showAt re-simulates from 0 each call: 120 renders + 7260 simulation steps
  return (performance.now() - t0);
});
console.log("120 renders + 7260 sim steps:", ms.toFixed(0), "ms");
const r = await page.evaluate(() => { const t0 = performance.now(); window.__testHooks.moveIt.trace(Array(600).fill(1 / 60), ["head"]); return performance.now() - t0; });
console.log("sim only: " + (r / 600).toFixed(3) + " ms/frame");
await browser.close();
