// End-to-end acceptance tests for Daily Collective Canvas.
// Runs the real main.js inside the mock runtime (harness.html) in independent
// Chromium contexts that share one mock world server.
//
//   node --test bits/daily-collective-canvas/harness/e2e.test.mjs
//
// Requires Playwright (resolved from the global npm root if not installed locally).
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { createWorldServer } from "./server.mjs";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch (e) {
  playwright = createRequire(execSync("npm root -g").toString().trim() + "/").call(null, "playwright");
}
const { chromium } = playwright;

const PORT = 8800 + Math.floor(Math.random() * 100);
const BASE = `http://localhost:${PORT}`;
const W = 1000, H = 1250;
let world, browser;
const pageErrors = [];
const clients = [];

before(async () => {
  world = createWorldServer();
  await new Promise(r => world.server.listen(PORT, r));
  const opts = {};
  try { require("fs").accessSync("/opt/pw-browsers/chromium"); } catch (e) { /* default */ }
  browser = await chromium.launch(opts);
});
after(async () => {
  for (const c of clients) await c.context.close().catch(() => {});
  await browser.close();
  world.server.close();
  assert.deepEqual(pageErrors, [], "no uncaught page errors");
});

// ---------------------------------------------------------------- helpers
const api = async (path, body) => (await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body || {}) })).json();
const store = async () => (await api("/api/test/store")).objects;
const reset = () => api("/api/test/reset");
const sleep = ms => new Promise(r => setTimeout(r, ms));

function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function fnv(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; }
const FIELDS = ["v", "d", "k", "s", "vr", "g", "c", "o", "w", "r", "f", "ro", "tg", "p", "t"];
function makeId(obj, nonce) {
  const picked = {};
  for (const k of FIELDS) if (obj[k] !== undefined) picked[k] = obj[k];
  return `${obj.d}_${nonce || Math.random().toString(36).slice(2, 10).padEnd(8, "x")}_${fnv(canon(picked)).toString(36)}`;
}
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
function dayKey(ms) { const p = {}; for (const x of dayFmt.formatToParts(new Date(ms))) p[x.type] = x.value; return `${p.year}-${p.month}-${p.day}`; }
function addDays(key, n) { const [y, m, d] = key.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d) + n * 86400000).toISOString().slice(0, 10); }
const today = () => dayKey(world.nowMs());

async function inject(obj, extra) {
  const id = makeId(obj);
  await api("/api/test/inject", Object.assign({ id, object: obj }, extra || {}));
  return id;
}
function rectObj(d, x0, y0, x1, y1, c, extra) {
  return Object.assign({ v: 1, d, k: "add", s: "rect", c: c || "#2b3ff5", o: 0.9, w: 30, f: 1, t: Date.now(), g: { x0, y0, x1, y1 } }, extra || {});
}

async function openClient(user, opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: opts.reducedMotion || "no-preference" });
  if (opts.clockTime) await context.clock.install({ time: opts.clockTime });
  const page = await context.newPage();
  page.on("pageerror", e => pageErrors.push(user + ": " + e.message));
  await page.goto(`${BASE}/?user=${user}`);
  await page.waitForSelector("body[data-inited='1']", { timeout: 15000 });
  const c = { user, context, page };
  clients.push(c);
  return c;
}
async function closeClient(c) { await c.context.close(); clients.splice(clients.indexOf(c), 1); }
async function rectOf(page) { const [x, y, w, h] = (await page.getAttribute(".dcc", "data-rect")).split(",").map(Number); return { x, y, w, h }; }
const u2c = (r, ux, uy) => ({ x: r.x + (ux / W) * r.w, y: r.y + (uy / H) * r.h });
async function drag(page, a, b, steps = 14) {
  const r = await rectOf(page), p0 = u2c(r, a[0], a[1]), p1 = u2c(r, b[0], b[1]);
  await page.mouse.move(p0.x, p0.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(p0.x + (p1.x - p0.x) * i / steps, p0.y + (p1.y - p0.y) * i / steps);
  await page.mouse.up();
}
async function scribble(page, pts) {
  const r = await rectOf(page);
  const c0 = u2c(r, pts[0][0], pts[0][1]);
  await page.mouse.move(c0.x, c0.y); await page.mouse.down();
  for (const [x, y] of pts.slice(1)) { const c = u2c(r, x, y); await page.mouse.move(c.x, c.y); }
  await page.mouse.up();
}
async function tap(page, ux, uy) { const r = await rectOf(page), p = u2c(r, ux, uy); await page.mouse.click(p.x, p.y); }
const mode = (page, m) => page.click(`.dcc-mode[data-mode="${m}"]`);
const tool = (page, m, t) => page.click(`.dcc-tools .dcc-chip[data-mode="${m}"][data-tool="${t}"]`);
const variant = (page, label) => page.locator(".dcc-vars .dcc-chip", { hasText: new RegExp("^" + label + "( ✓)?$") }).click();
// Sets an exact colour through the picker's hex field, then closes the picker.
async function swatch(page, hex) {
  if (!(await page.isVisible(".dcc-pick"))) await page.click(".dcc-cur");
  await page.fill(".dcc-hexin", hex);
  await page.click(".dcc-pickdone");
}
async function slider(page, cls, value) {
  await page.$eval(cls, (el, v) => { el.value = String(v); el.dispatchEvent(new Event("input", { bubbles: true })); }, value);
}
async function draftVisible(page) { return page.$eval(".dcc-draft", el => !el.hidden && el.style.visibility !== "hidden"); }
// Marks save on their own after a short settle; previews (tint, react, texture...) need Apply.
async function commit(c) {
  const stage = await c.page.getAttribute(".dcc", "data-draft");
  if (stage === "draft") await c.page.click(".dcc-commit");
  await c.page.waitForFunction(() => { const r = document.querySelector(".dcc"); return r.dataset.draft === "" && r.dataset.outbox === "0"; }, null, { timeout: 10000 });
}
async function marks(page) { const m = /(\d+) marks?/.exec(await page.textContent(".dcc-meta")); return m ? Number(m[1]) : -1; }
async function waitMarks(page, n, timeout = 12000) {
  await page.waitForFunction(n => { const m = /(\d+) marks?/.exec(document.querySelector(".dcc-meta").textContent); return m && Number(m[1]) === n; }, n, { timeout });
}
async function canvasHash(page, region) {
  return page.evaluate(region => {
    const c = document.querySelector("#stage canvas");
    const g = c.getContext("2d");
    const s = c.width / c.clientWidth;
    const [x, y, w, h] = region ? region.map(v => Math.round(v * s)) : [0, 0, c.width, c.height];
    const d = g.getImageData(x, y, w, h).data;
    let hsh = 2166136261;
    for (let i = 0; i < d.length; i += 1) hsh = Math.imul(hsh ^ d[i], 16777619);
    return (hsh >>> 0).toString(16) + ":" + w + "x" + h;
  }, region);
}
async function artRegion(page, ux0, uy0, ux1, uy1) {
  const r = await rectOf(page), a = u2c(r, ux0, uy0), b = u2c(r, ux1, uy1);
  return [a.x, a.y, b.x - a.x, b.y - a.y];
}
const settle = page => page.waitForTimeout(250);
const recs = async () => Object.entries(await store()).map(([id, e]) => Object.assign({ id }, e));

// ======================================================= A. Shared multiplayer
test("A: a committed ADD reaches another client without reload and renders identically", async () => {
  await reset();
  const a = await openClient("alice"), b = await openClient("bob");
  await tool(a.page, "add", "shape");
  await drag(a.page, [200, 300], [600, 700]);
  await commit(a);
  const rs = await recs();
  assert.equal(rs.length, 1, "server persisted exactly one contribution");
  assert.equal(rs[0].object.s, "ellipse");
  await waitMarks(b.page, 1);
  await settle(a.page); await settle(b.page);
  assert.equal(await canvasHash(a.page), await canvasHash(b.page), "both clients rendered identical pixels");
  // Duplicate delivery: replaying the same id + object is idempotent and never duplicates.
  const r = await api("/api/test/store");
  const [id, e] = Object.entries(r.objects)[0];
  const replay = await b.page.evaluate(m => window.__ctx.memory.world("canvas").mutate(m), { id, object: e.object });
  assert.equal(replay.replay, true);
  await b.page.waitForTimeout(4500);
  assert.equal(await marks(b.page), 1);
  assert.equal((await recs()).length, 1);
  await closeClient(a); await closeClient(b);
});

test("A: simultaneous contributions are all preserved and ordered the same everywhere", async () => {
  await reset();
  const a = await openClient("alice"), b = await openClient("bob");
  await tool(a.page, "add", "shape"); await tool(b.page, "add", "shape");
  await drag(a.page, [150, 200], [550, 600]);
  await swatch(b.page, "#ffcc1a");
  await drag(b.page, [350, 400], [800, 900]);
  await Promise.all([commit(a), commit(b)]);
  await waitMarks(a.page, 2); await waitMarks(b.page, 2);
  assert.equal((await recs()).length, 2);
  await settle(a.page); await settle(b.page);
  assert.equal(await canvasHash(a.page), await canvasHash(b.page), "same composition order on both clients");
  await closeClient(a); await closeClient(b);
});

test("A: a client that was offline recovers missed contributions after reconnecting", async () => {
  await reset();
  const a = await openClient("alice"), b = await openClient("bob");
  await b.context.setOffline(true);
  await b.page.waitForFunction(() => document.querySelector(".dcc-sync").dataset.s === "offline", null, { timeout: 12000 });
  await tool(a.page, "add", "stamp");
  await tap(a.page, 500, 500);
  await commit(a);
  assert.equal(await marks(b.page), 0, "offline client has not seen it yet");
  await b.context.setOffline(false);
  await b.page.evaluate(() => window.dispatchEvent(new Event("online")));
  await waitMarks(b.page, 1, 20000);
  await closeClient(a); await closeClient(b);
});

// ======================================================= B. ADD
test("B: every ADD mark type persists as structured, normalized geometry with its style", async () => {
  await reset();
  const a = await openClient("alice");
  const expect = [];
  // freehand
  await tool(a.page, "add", "brush"); await variant(a.page, "chalk");
  await swatch(a.page, "#f2421b"); await slider(a.page, ".dcc-o", 60); await slider(a.page, ".dcc-s", 50);
  await scribble(a.page, [[100, 100], [160, 180], [240, 140], [320, 220], [400, 160]]);
  await commit(a); expect.push({ s: "brush", vr: "chalk", c: "#f2421b", o: 0.6, w: 50 });
  // shapes
  await tool(a.page, "add", "shape");
  for (const [label, s] of [["ellipse", "ellipse"], ["rectangle", "rect"], ["polygon", "poly"], ["blob", "blob"]]) {
    await variant(a.page, label);
    await slider(a.page, ".dcc-r", 30);
    await drag(a.page, [200, 300], [520, 600]);
    await commit(a); expect.push({ s, r: 30 });
  }
  // lines
  await tool(a.page, "add", "line");
  await variant(a.page, "line"); await drag(a.page, [100, 900], [800, 1000]); await commit(a); expect.push({ s: "line" });
  await variant(a.page, "arc"); await slider(a.page, ".dcc-r", 90); await drag(a.page, [100, 1100], [800, 1100]); await commit(a); expect.push({ s: "arc" });
  // dots and stamps
  await tool(a.page, "add", "dots"); await variant(a.page, "ring"); await drag(a.page, [700, 300], [800, 300]); await commit(a); expect.push({ s: "dots", vr: "ring" });
  await tool(a.page, "add", "stamp"); await variant(a.page, "eye"); await tap(a.page, 700, 700); await commit(a); expect.push({ s: "stamp", vr: "eye" });
  const rs = (await recs()).sort((x, y) => x.seq - y.seq);
  assert.equal(rs.length, expect.length);
  rs.forEach((r, i) => {
    for (const [k, v] of Object.entries(expect[i])) assert.equal(r.object[k], v, `record ${i} field ${k}`);
    assert.equal(r.object.k, "add");
    assert.ok(r.object.g, "geometry stored");
    assert.ok(Buffer.byteLength(JSON.stringify({ id: r.id, object: r.object })) <= 1024);
  });
  const shape = rs[1].object.g;
  assert.ok(shape.x0 >= 190 && shape.x0 <= 210 && shape.y1 >= 590 && shape.y1 <= 610, "coordinates stored in normalized canvas units");
  await waitMarks(a.page, expect.length);
  await closeClient(a);
});

test("B: undoing a fresh mark creates no record; long strokes stay under the payload limit", async () => {
  await reset();
  const a = await openClient("alice");
  await tool(a.page, "add", "shape");
  await drag(a.page, [100, 100], [400, 400]);
  assert.equal(await a.page.textContent(".dcc-cancel"), "Undo");
  await a.page.click(".dcc-cancel");
  await a.page.waitForTimeout(2200);
  assert.equal((await recs()).length, 0, "undo left no server record");
  // A very long scribble is simplified to fit the 1 KB mutation limit.
  await tool(a.page, "add", "brush"); await variant(a.page, "ink");
  const pts = [];
  for (let i = 0; i < 400; i++) pts.push([100 + (i % 40) * 20 + Math.sin(i) * 8, 100 + Math.floor(i / 40) * 100 + Math.cos(i * 1.3) * 30]);
  await scribble(a.page, pts);
  await commit(a);
  const rs = await recs();
  assert.equal(rs.length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify({ id: rs[0].id, object: rs[0].object })) <= 1024);
  // The server boundary rejects oversized payloads outright.
  const big = await a.page.evaluate(async () => {
    try { await window.__ctx.memory.world("canvas").mutate({ id: "x", object: { pad: "y".repeat(2000) } }); return "accepted"; } catch (e) { return e.code; }
  });
  assert.equal(big, "payload_too_large");
  await closeClient(a);
});

test("B: a record altered after commit is refused by every client (immutability check)", async () => {
  await reset();
  const d = today();
  const id = await inject(rectObj(d, 100, 100, 300, 300));
  const a = await openClient("alice");
  await waitMarks(a.page, 1);
  await api("/api/test/overwrite", { id, object: rectObj(d, 100, 100, 900, 900, "#f2421b") });
  await waitMarks(a.page, 0);
  await closeClient(a);
});

// ======================================================= C. CONTRIBUTE
test("C: echo, connect and react save new records that reference their targets", async () => {
  await reset();
  const d = today();
  const t1 = await inject(rectObj(d, 150, 200, 350, 400, "#2b3ff5"));
  const t2 = await inject(rectObj(d, 600, 700, 800, 900, "#ffcc1a"));
  const before = JSON.stringify((await store())[t1].object);
  const a = await openClient("alice");
  await waitMarks(a.page, 2);
  await mode(a.page, "con");
  // Echo: select then drag a direction
  await tool(a.page, "con", "echo");
  await tap(a.page, 250, 300);
  assert.match(await a.page.textContent(".dcc-chipselt"), /rectangle/);
  await drag(a.page, [250, 300], [320, 340]);
  await variant(a.page, "x5");
  await commit(a);
  // Connect: two targets
  await tool(a.page, "con", "connect");
  await tap(a.page, 170, 220);                 // a corner only the original covers (the echo sits on top elsewhere)
  assert.match(await a.page.textContent(".dcc-chipselt"), /rectangle/);
  await drag(a.page, [170, 220], [700, 800]);
  await variant(a.page, "vine");
  await commit(a);
  // React
  await tool(a.page, "con", "react");
  await tap(a.page, 780, 720);                 // part of the yellow square away from the connector
  assert.match(await a.page.textContent(".dcc-chipselt"), /rectangle/);
  await variant(a.page, "rays");
  await commit(a);
  const rs = (await recs()).filter(r => r.object.k === "con").sort((x, y) => x.seq - y.seq);
  assert.deepEqual(rs.map(r => r.object.s), ["echo", "connect", "react"]);
  assert.deepEqual(rs[0].object.tg, [t1]);
  assert.equal(rs[0].object.p.n, 5);
  assert.deepEqual(rs[1].object.tg, [t1, t2], "connection stores both targets");
  assert.deepEqual(rs[2].object.tg, [t2]);
  assert.equal(JSON.stringify((await store())[t1].object), before, "target record unchanged");
  // Relationships survive a refresh
  await a.page.reload(); await a.page.waitForSelector("body[data-inited='1']");
  await waitMarks(a.page, 5);
  await closeClient(a);
});

test("C: overlapping marks can be cycled through so obscured targets stay selectable", async () => {
  await reset();
  const d = today();
  await inject(rectObj(d, 300, 300, 700, 700, "#2b3ff5"));
  await inject(Object.assign(rectObj(d, 350, 350, 650, 650, "#ffcc1a"), { s: "ellipse" }));
  const a = await openClient("alice");
  await waitMarks(a.page, 2);
  await mode(a.page, "con");
  await tool(a.page, "con", "react");
  await tap(a.page, 500, 500);
  assert.match(await a.page.textContent(".dcc-chipselt"), /ellipse.*1 of 2/);
  await tap(a.page, 500, 500);
  assert.match(await a.page.textContent(".dcc-chipselt"), /rectangle.*2 of 2/);
  await a.page.click(".dcc-cycle");
  assert.match(await a.page.textContent(".dcc-chipselt"), /ellipse.*1 of 2/);
  await closeClient(a);
});

test("C/D: invalid relationships are ignored without breaking the canvas", async () => {
  await reset();
  const d = today(), y = addDays(d, -1);
  const good = await inject(rectObj(d, 100, 100, 300, 300));
  const old = await inject(rectObj(y, 100, 100, 300, 300));
  const ghostTarget = makeId(rectObj(d, 1, 1, 2, 2));
  const base = { v: 1, d, c: "#f2421b", o: 0.8, w: 20, t: Date.now() };
  await inject(Object.assign({}, base, { k: "con", s: "react", vr: "halo", tg: [ghostTarget], g: { x0: 0, y0: 0, x1: 10, y1: 10 } }));   // missing target
  await inject(Object.assign({}, base, { k: "con", s: "react", vr: "halo", tg: [old], g: { x0: 0, y0: 0, x1: 10, y1: 10 } }));          // cross-day target
  const tint = await inject(Object.assign({}, base, { k: "tf", s: "tint", vr: "multiply", tg: [good] }));                                 // valid
  await inject(Object.assign({}, base, { k: "tf", s: "tint", vr: "multiply", tg: [tint] }));                                             // transform of a transform
  await inject(Object.assign({}, base, { k: "add", s: "rect", c: "red", g: { x0: 0, y0: 0, x1: 5, y1: 5 } }));                            // malformed colour
  await inject(Object.assign({}, base, { k: "add", s: "rect", g: { x0: 0, y0: 0, x1: 99999, y1: 5 } }));                                  // geometry out of range
  const a = await openClient("alice");
  await waitMarks(a.page, 2);   // the good mark + its tint
  await closeClient(a);
});

// ======================================================= D. TRANSFORM
test("D: tint, mask, shift and texture visibly change the target and leave it intact", async () => {
  await reset();
  const d = today();
  const t = await inject(rectObj(d, 250, 300, 750, 800, "#2b3ff5"));
  const original = JSON.stringify((await store())[t].object);
  const a = await openClient("alice");
  await waitMarks(a.page, 1);
  const region = await artRegion(a.page, 200, 250, 900, 950);
  await mode(a.page, "tf");
  let prev = await canvasHash(a.page, region);
  // Cancelled preview leaves nothing behind.
  await tool(a.page, "tf", "tint"); await tap(a.page, 500, 550);
  assert.ok(await draftVisible(a.page));
  await a.page.click(".dcc-cancel");
  await a.page.waitForTimeout(300);
  assert.equal((await recs()).length, 1);
  const steps = [
    ["tint", async () => { await tap(a.page, 500, 550); await swatch(a.page, "#ffcc1a"); }],
    ["mask", async () => { await tap(a.page, 500, 550); await drag(a.page, [500, 550], [620, 550]); }],
    ["shift", async () => { await tap(a.page, 500, 550); await drag(a.page, [500, 550], [580, 620]); }],
    ["texture", async () => { await tap(a.page, 500, 550); await variant(a.page, "halftone"); }]
  ];
  for (const [name, act] of steps) {
    await tool(a.page, "tf", name);
    await act();
    await commit(a);
    await settle(a.page);
    const h = await canvasHash(a.page, region);
    assert.notEqual(h, prev, name + " changed the composition");
    prev = h;
  }
  const rs = (await recs()).filter(r => r.object.k === "tf");
  assert.deepEqual(rs.map(r => r.object.s).sort(), ["mask", "shift", "texture", "tint"]);
  for (const r of rs) assert.deepEqual(r.object.tg, [t]);
  assert.equal(JSON.stringify((await store())[t].object), original, "target untouched");
  // Another client and a reload reproduce the same pixels.
  const b = await openClient("bob");
  await waitMarks(b.page, 5);
  await settle(b.page); await settle(a.page);
  assert.equal(await canvasHash(b.page), await canvasHash(a.page));
  await closeClient(a); await closeClient(b);
});

// ======================================================= G. Resilience
test("G: a lost response is retried with the same idempotency key and saved once", async () => {
  await reset();
  const a = await openClient("alice");
  await tool(a.page, "add", "shape");
  await api("/api/test/failNext", { mode: "after_persist" });
  await drag(a.page, [200, 200], [500, 500]);
  await a.page.waitForFunction(() => /Not saved/.test(document.querySelector(".dcc-dmsg").textContent), null, { timeout: 8000 });
  assert.equal(await a.page.textContent(".dcc-commit"), "Retry");
  // It retries by itself once the connection answers again (or on Retry).
  await a.page.waitForFunction(() => document.querySelector(".dcc").dataset.outbox === "0", null, { timeout: 15000 });
  const r = await api("/api/test/store");
  assert.equal(Object.keys(r.objects).length, 1, "exactly one record");
  const ids = r.log.map(l => l.id);
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1], "retry reused the idempotency key");
  await closeClient(a);
});

test("G: an expired session keeps the mark and explains what happened", async () => {
  await reset();
  const a = await openClient("alice");
  await tool(a.page, "add", "dots");
  await api("/api/test/failNext", { mode: "auth" });
  await tap(a.page, 500, 500);
  await a.page.waitForFunction(() => /session/.test(document.querySelector(".dcc-dmsg").textContent), null, { timeout: 8000 });
  assert.equal((await recs()).length, 0);
  assert.equal(await a.page.getAttribute(".dcc", "data-outbox"), "1");
  await a.page.click(".dcc-commit");          // Retry once signed in again
  await a.page.waitForFunction(() => document.querySelector(".dcc").dataset.outbox === "0", null, { timeout: 8000 });
  assert.equal((await recs()).length, 1);
  await closeClient(a);
});

test("G: rapid drawing never waits on the network, and unsaved marks survive a reload", async () => {
  await reset();
  const a = await openClient("alice");
  await tool(a.page, "add", "brush");
  for (let i = 0; i < 4; i++) await scribble(a.page, [[100 + i * 150, 200], [150 + i * 150, 300], [120 + i * 150, 420]]);
  await commit(a);
  assert.equal((await recs()).length, 4, "four quick strokes, four records");
  await api("/api/test/down", { down: true });
  await tool(a.page, "add", "stamp");
  await tap(a.page, 400, 800);
  await a.page.waitForFunction(() => /connection/.test(document.querySelector(".dcc-dmsg").textContent), null, { timeout: 8000 });
  await a.page.reload(); await a.page.waitForSelector("body[data-inited='1']");
  assert.equal(await a.page.getAttribute(".dcc", "data-outbox"), "1", "the unsaved mark came back after reload");
  await api("/api/test/down", { down: false });
  await a.page.waitForFunction(() => document.querySelector(".dcc").dataset.outbox === "0", null, { timeout: 20000 });
  assert.equal((await recs()).length, 5);
  await closeClient(a);
});

// ======================================================= E. Daily lifecycle
test("E: rollover follows the server clock, archives the day and never moves marks silently", async () => {
  await reset();
  const d0 = dayKey(Date.now());
  const [y, m, dd] = d0.split("-").map(Number);
  const target = Date.UTC(y, m - 1, dd, 18, 29, 40);   // 23:59:40 IST
  await api("/api/test/clock", { offsetMs: target - Date.now() });
  const a = await openClient("alice");
  await tool(a.page, "add", "shape");
  await drag(a.page, [200, 200], [500, 500]);
  await commit(a);
  await api("/api/test/down", { down: true });           // this one can't reach the server before midnight
  await drag(a.page, [500, 600], [800, 900]);
  await a.page.waitForFunction(() => /connection/.test(document.querySelector(".dcc-dmsg").textContent), null, { timeout: 8000 });
  await api("/api/test/clock", { offsetMs: target + 40000 - Date.now() });
  await api("/api/test/down", { down: false });
  await a.page.waitForFunction(() => /0 marks/.test(document.querySelector(".dcc-meta").textContent), null, { timeout: 20000 });
  assert.match(await a.page.textContent(".dcc-toast"), /archive/);
  await a.page.waitForFunction(() => /midnight/.test(document.querySelector(".dcc-dmsg").textContent), null, { timeout: 8000 });
  assert.equal(await a.page.textContent(".dcc-commit"), "Add to today");
  assert.equal((await recs()).length, 1, "nothing was silently written to either day");
  await a.page.click(".dcc-commit");
  await commit(a);
  const rs = (await recs()).sort((p, q) => p.seq - q.seq);
  assert.equal(rs[0].object.d, d0);
  assert.equal(rs[1].object.d, addDays(d0, 1));
  await a.page.click(".dcc-nav");
  const cards = await a.page.$$eval(".dcc-card", els => els.map(e => e.dataset.day + "|" + e.querySelector(".cm").textContent));
  assert.deepEqual(cards, [addDays(d0, 1) + "|1 mark · 1 person", d0 + "|1 mark · 1 person"]);
  await closeClient(a);
  await api("/api/test/clock", { offsetMs: 0 });
});

test("E: a wrong device clock cannot change the canonical canvas", async () => {
  await reset();
  const a = await openClient("alice", { clockTime: Date.now() + 5 * 86400000 });
  await a.page.waitForTimeout(800);
  const expected = await a.page.evaluate(k => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(Date.parse(k + "T00:00:00Z"))), today());
  assert.equal(await a.page.textContent(".dcc-day"), expected, "shows the server's day, not the device's");
  await tool(a.page, "add", "stamp");
  await tap(a.page, 500, 500);
  await commit(a);
  assert.equal((await recs())[0].object.d, today());
  await closeClient(a);
});

// ======================================================= F. Archive
test("F: the archive lists every day (quiet ones too) and opens them read-only", async () => {
  await reset();
  const d = today();
  const d3 = addDays(d, -3), d1 = addDays(d, -1);
  const r3 = await inject(rectObj(d3, 100, 100, 600, 600, "#ff5fa2"));
  await inject(Object.assign({ v: 1, d: d3, k: "tf", s: "tint", vr: "multiply", c: "#ffcc1a", o: 0.7, w: 30, t: Date.now(), tg: [r3] }));
  await inject(rectObj(d1, 300, 300, 900, 900, "#0f8a6a"));
  const a = await openClient("alice");
  await a.page.click(".dcc-nav");
  const days = await a.page.$$eval(".dcc-card", els => els.map(e => [e.dataset.day, e.querySelector(".cm").textContent]));
  assert.deepEqual(days.map(x => x[0]), [d, d1, addDays(d, -2), d3]);
  assert.equal(days[2][1], "a quiet day");
  await a.page.waitForFunction(() => document.querySelectorAll(".dcc-card img.th").length === 4, null, { timeout: 8000 });
  await a.page.click(`.dcc-card[data-day="${d3}"]`);
  assert.match(await a.page.textContent(".dcc-meta"), /archived · read-only · 2 marks/);
  assert.equal(await a.page.isVisible(".dcc-modes"), false, "no contribution controls on archived canvas");
  assert.match(await a.page.textContent(".dcc-histt"), /read-only/);
  await tap(a.page, 350, 350);
  assert.match(await a.page.textContent(".dcc-chipselt"), /rectangle/);
  // Gestures on an archived canvas never create drafts or records.
  await drag(a.page, [100, 900], [800, 1100]);
  assert.equal(await draftVisible(a.page), false);
  // Quiet day opens too.
  await a.page.click(".dcc-back");
  await a.page.click(`.dcc-card[data-day="${addDays(d, -2)}"]`);
  assert.match(await a.page.textContent(".dcc-meta"), /0 marks/);
  await a.page.click(".dcc-totoday");
  assert.equal(await a.page.isVisible(".dcc-modes"), true);
  assert.equal((await recs()).length, 3);
  await closeClient(a);
});

// ======================================================= H. Interface quality
test("H: geometry keeps its proportions across viewport sizes", async () => {
  await reset();
  const d = today();
  await inject(rectObj(d, 400, 500, 600, 750, "#16130f"));
  const phone = await openClient("alice", { viewport: { width: 360, height: 740 } });
  const desk = await openClient("bob", { viewport: { width: 1280, height: 860 } });
  for (const c of [phone, desk]) {
    await waitMarks(c.page, 1);
    await settle(c.page);
    const r = await rectOf(c.page);
    assert.ok(Math.abs(r.w / r.h - 0.8) < 0.01, "4:5 canvas");
    // centre of the mark is ink, a point outside it is paper
    const inside = u2c(r, 500, 625), outside = u2c(r, 300, 400);
    const [pin, pout] = await c.page.evaluate(([i, o]) => {
      const cv = document.querySelector("#stage canvas"), g = cv.getContext("2d"), s = cv.width / cv.clientWidth;
      const px = p => Array.from(g.getImageData(Math.round(p.x * s), Math.round(p.y * s), 1, 1).data);
      return [px(i), px(o)];
    }, [inside, outside]);
    assert.ok(pin[0] < 80, "mark centre is dark ink at " + c.user);
    assert.ok(pout[0] > 200, "outside the mark is paper at " + c.user);
  }
  await closeClient(phone); await closeClient(desk);
});

test("H: keyboard can switch actions, undo and apply; reduced motion works", async () => {
  await reset();
  const a = await openClient("alice", { reducedMotion: "reduce" });
  await a.page.keyboard.press("2");
  assert.equal(await a.page.getAttribute('.dcc-mode[data-mode="con"]', "aria-pressed"), "true");
  await a.page.keyboard.press("1");
  await tool(a.page, "add", "stamp");
  await tap(a.page, 500, 500);
  await commit(a);
  assert.equal((await recs()).length, 1);
  await tap(a.page, 300, 300);
  await a.page.keyboard.press("Escape");             // undo before it settles
  await a.page.waitForTimeout(2200);
  assert.equal((await recs()).length, 1);
  await a.page.keyboard.press("3");
  await tool(a.page, "tf", "tint");
  await tap(a.page, 500, 500);
  await a.page.focus(".dcc-commit");
  assert.equal(await a.page.textContent(".dcc-commit"), "Apply");
  await a.page.keyboard.press("Enter");
  await commit(a);
  assert.equal((await recs()).length, 2);
  await closeClient(a);
});

test("H: View shows the whole canvas full-screen, look-only, and Done returns", async () => {
  await reset();
  await inject(rectObj(today(), 400, 500, 600, 750, "#16130f"));
  const a = await openClient("alice");
  await waitMarks(a.page, 1);
  const before = await rectOf(a.page);
  await a.page.click(".dcc-viewbtn");
  const big = await rectOf(a.page);
  assert.ok(big.w > before.w && big.h > before.h, "canvas is larger in View");
  assert.ok(Math.abs(big.w / big.h - 0.8) < 0.01, "still the whole 4:5 canvas");
  assert.equal(await a.page.isVisible(".dcc-modes"), false, "tools step aside");
  assert.match(await a.page.textContent(".dcc-viewt"), /1 mark/);
  await drag(a.page, [100, 100], [300, 300]);          // looking never draws
  await a.page.waitForTimeout(2000);
  assert.equal((await recs()).length, 1);
  await a.page.click(".dcc-done");
  assert.deepEqual(await rectOf(a.page), before);
  assert.equal(await a.page.isVisible(".dcc-modes"), true);
  await a.page.keyboard.press("v");
  assert.equal(await a.page.isVisible(".dcc-viewcap"), true);
  await a.page.keyboard.press("Escape");
  assert.equal(await a.page.isVisible(".dcc-viewcap"), false);
  await closeClient(a);
});

test("ADD: the full-spectrum picker sets the exact colour that previews, saves and renders", async () => {
  await reset();
  const a = await openClient("alice"), b = await openClient("bob");
  // Inline hue strip: drag to the orange region.
  const hb = await a.page.locator(".dcc-hue-inline").boundingBox();
  await a.page.mouse.move(hb.x + 4, hb.y + hb.height / 2); await a.page.mouse.down();
  await a.page.mouse.move(hb.x + hb.width * 0.08, hb.y + hb.height / 2, { steps: 4 }); await a.page.mouse.up();
  const hue = await a.page.getAttribute(".dcc", "data-color");
  assert.match(hue, /^#[0-9a-f]{6}$/);
  // Open the field and pick a muted variation; it stays open while choosing and drawing.
  await a.page.click(".dcc-cur");
  const sv = await a.page.locator(".dcc-sv").boundingBox();
  await a.page.mouse.move(sv.x + sv.width * 0.9, sv.y + 4); await a.page.mouse.down();
  await a.page.mouse.move(sv.x + sv.width * 0.4, sv.y + sv.height * 0.35, { steps: 5 }); await a.page.mouse.up();
  const picked = await a.page.getAttribute(".dcc", "data-color");
  assert.notEqual(picked, hue, "saturation/brightness changed the colour");
  assert.equal(await a.page.isVisible(".dcc-pick"), true);
  await tool(a.page, "add", "brush");
  assert.equal(await a.page.isVisible(".dcc-pick"), true, "switching brush keeps the picker open");
  assert.equal(await a.page.getAttribute(".dcc", "data-color"), picked, "colour preserved across brushes");
  await scribble(a.page, [[150, 120], [300, 200], [450, 120], [600, 200]]);
  // The settling mark picks up a colour change immediately.
  await a.page.fill(".dcc-hexin", "#7a1fe0");
  await commit(a);
  let rs = await recs();
  assert.equal(rs[0].object.c, "#7a1fe0", "submitted colour is the exact chosen hex");
  await a.page.keyboard.press("Escape");
  assert.equal(await a.page.isVisible(".dcc-pick"), false, "Escape dismisses the picker");
  // Same exact colour on another client.
  await waitMarks(b.page, 1);
  await settle(a.page); await settle(b.page);
  assert.equal(await canvasHash(a.page), await canvasHash(b.page));
  // Keyboard adjusts hue on the strip.
  await a.page.focus(".dcc-hue-inline");
  const beforeKey = await a.page.getAttribute(".dcc", "data-color");
  await a.page.keyboard.press("ArrowRight");
  assert.notEqual(await a.page.getAttribute(".dcc", "data-color"), beforeKey);
  // The chosen colour survives a reload.
  const kept = await a.page.getAttribute(".dcc", "data-color");
  await a.page.waitForTimeout(1500);
  await a.page.reload(); await a.page.waitForSelector("body[data-inited='1']");
  assert.equal(await a.page.getAttribute(".dcc", "data-color"), kept);
  await closeClient(a); await closeClient(b);
});
