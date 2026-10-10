#!/usr/bin/env node
// Renders a Bit in headless Chromium at phone size and saves a screenshot.
//   NODE_PATH=$(npm root -g) node tools/preview/shoot.cjs --bit dont-wake-it \
//     --out shot.png [--width 390 --height 844 --dpr 2] [knob=value ...]
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const opt = { width: 390, height: 844, dpr: 2, timeout: 90000 };
const knobs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) opt[args[i].slice(2)] = args[++i];
  else knobs.push(args[i]);
}
if (!opt.bit || !opt.out) {
  console.error("usage: shoot.cjs --bit <name> --out <file.png> [knob=value ...]");
  process.exit(1);
}

const root = path.resolve(__dirname, "..", "..");
const types = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json", ".cjs": "text/javascript" };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    res.writeHead(404);
    return res.end();
  }
  res.writeHead(200, { "content-type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

server.listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  let code = 0;
  try {
    const page = await browser.newPage({
      viewport: { width: +opt.width, height: +opt.height },
      deviceScaleFactor: +opt.dpr,
      isMobile: true,
      hasTouch: true
    });
    page.on("console", (m) => console.log(`[${m.type()}] ${m.text()}`));
    page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
    const q = new URLSearchParams({ bit: opt.bit });
    for (const kv of knobs) {
      const [k, v] = kv.split("=");
      q.set(k, v);
    }
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${port}/tools/preview/index.html?${q}`);
    await page.waitForFunction(() => window.__bitReady || (window.__bitErrors && window.__bitErrors.length), null, { timeout: +opt.timeout });
    const info = await page.evaluate(() => ({ errors: window.__bitErrors, initMs: window.__bitInitMs }));
    await page.screenshot({ path: opt.out });
    console.log(JSON.stringify({ out: opt.out, wallMs: Date.now() - t0, ...info }));
    if (info.errors && info.errors.length) code = 2;
  } catch (e) {
    console.error(e);
    code = 1;
  } finally {
    await browser.close();
    server.close();
    process.exit(code);
  }
});
