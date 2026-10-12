// Renders playback of a saved scene at chosen times (simulated at 60fps)
// and tiles them into one image for frame-by-frame review.
// Usage: PROJ="$(cat scene-project.json)" node dev/frames.mjs out.png t0 t1 step [clipY clipH]
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const [outFile, t0, t1, step, cy = 260, ch = 330] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await page.goto("file://" + path.join(here, "index.html"));
await page.evaluate((p) => localStorage.setItem("bit:move-it-project", p), process.env.PROJ);
await page.goto("file://" + path.join(here, "index.html"));
await page.waitForFunction(() => window.__bitReady);
const shots = [];
for (let t = +t0; t <= +t1 + 1e-9; t += +step) {
  await page.evaluate((t) => window.__testHooks.moveIt.showAt(t, 60), t);
  shots.push(await page.screenshot({ clip: { x: 20, y: +cy, width: 350, height: +ch } }));
}
// tile with a tiny canvas page
const tile = await browser.newPage();
const cols = Math.min(shots.length, 8);
await tile.setContent(`<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},175px);gap:2px">` +
  shots.map((b, i) => `<div style="position:relative"><img style="width:175px;display:block" src="data:image/png;base64,${b.toString("base64")}"><span style="position:absolute;left:4px;top:2px;color:#888;font:11px sans-serif">${(+t0 + i * +step).toFixed(3)}</span></div>`).join("") + "</body>");
await tile.screenshot({ path: outFile, fullPage: true });
await browser.close();
