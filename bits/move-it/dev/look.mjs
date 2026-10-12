// Quick visual check: opens the app in a phone viewport and saves a screenshot.
import { chromium } from "/opt/node22/lib/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto("file://" + path.join(here, "index.html"));
await page.evaluate(() => localStorage.clear());
await page.goto("file://" + path.join(here, "index.html"));
await page.waitForFunction(() => window.__bitReady);
await page.waitForTimeout(200);
await page.screenshot({ path: process.argv[2] });
console.log("errors:", errors);
await browser.close();
