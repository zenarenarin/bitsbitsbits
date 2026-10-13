// Automated play-test driver for REWIND in the local harness.
// Usage: NODE_PATH=$(npm root -g) node dev/playtest.cjs <scenario> [outDir]
// Requires the dev server: npx http-server -p 8123 -c-1 bits/rewind
// Optional VENDOR=<dir> serves libs.plethora.studio files from a local mirror.
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const scenario = process.argv[2] || "smoke";
const outDir = process.argv[3] || path.join(__dirname, "..", ".playtest");
fs.mkdirSync(outDir, { recursive: true });
const VENDOR = process.env.VENDOR;
const W = parseInt(process.env.W || "390", 10), H = parseInt(process.env.H || "844", 10);

async function main() {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME || undefined,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
  });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: process.env.TOUCH === "1" });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(m.type() + ": " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  if (VENDOR) {
    await page.route("https://libs.plethora.studio/**", async (route) => {
      const u = new URL(route.request().url());
      const local = path.join(VENDOR, u.pathname.replace(/^\/three\/0\.164\.1\//, "").replace(/^\//, ""));
      if (fs.existsSync(local)) {
        const type = local.endsWith(".js") ? "text/javascript" : "font/ttf";
        return route.fulfill({ status: 200, body: fs.readFileSync(local), headers: { "content-type": type, "access-control-allow-origin": "*" } });
      }
      return route.abort();
    });
  }
  const url = `http://localhost:8123/dev/index.html?debug=1&w=${W}&h=${H}` + (process.env.MANUAL ? "&manualclock=1" : "");
  await page.goto(url);
  await page.waitForFunction(() => window.__rewindDebug && window.__rewindDebug.run, null, { timeout: 30000 });
  const ctx = { page, outDir, errors, shot: (n) => page.screenshot({ path: path.join(outDir, n + ".png"), timeout: 120000 }) };
  const mod = require(path.join(__dirname, "scenarios.cjs"));
  if (!mod[scenario]) throw new Error("unknown scenario " + scenario);
  const result = await mod[scenario](ctx);
  console.log(JSON.stringify({ scenario, result, errors: errors.slice(0, 30) }, null, 1));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
