// Local development harness for Daily Collective Canvas.
//
// Serves the Bit inside a mock Plethora runtime (harness.html) and stands in
// for the platform's shared `objects` world so several browser clients can
// play against one store. It is NOT part of the uploaded Bit.
//
// The mock world enforces the documented limits (1 KB mutations, 256 KB
// snapshots, the manifest's per-user daily rate limit) and adds controls the
// tests use: a settable server clock, simulated outages, a lost-response
// failure mode, and raw injection for tamper tests.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const bitDir = path.resolve(here, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(bitDir, "plethora.json"), "utf8"));
const rule = manifest.memory.worlds.canvas.rules.find(r => r.type === "rate_limit");

const MAX_MUTATION = 1024;
const MAX_SNAPSHOT = 262144;

function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
const dayFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });
function dayKey(ms) {
  const p = {};
  for (const x of dayFmt.formatToParts(new Date(ms))) p[x.type] = x.value;
  return `${p.year}-${p.month}-${p.day}`;
}

export function createWorldServer() {
  const state = {
    objects: new Map(),      // id -> { object, createdAt, authorId, seq }
    seq: 0,
    clockOffset: 0,
    down: false,
    failNext: null,          // "after_persist" | "before_persist"
    rate: new Map(),         // user:day -> count
    log: []
  };
  const nowMs = () => Date.now() + state.clockOffset;

  function snapshot() {
    return {
      objects: Array.from(state.objects.entries()).map(([id, e]) => ({ id, object: e.object, createdAt: e.createdAt, authorId: e.authorId, seq: e.seq })),
      serverTime: new Date(nowMs()).toISOString()
    };
  }

  function mutate(user, body) {
    const bytes = Buffer.byteLength(JSON.stringify(body));
    if (bytes > MAX_MUTATION) return [413, { code: "payload_too_large", message: "mutation exceeds 1024 bytes" }];
    if (!body || typeof body.id !== "string" || !body.object || typeof body.object !== "object") return [400, { code: "invalid_mutation" }];
    const existing = state.objects.get(body.id);
    if (existing) {
      // Same id + same content = idempotent replay. Different content is refused
      // (mock stand-in for the append-only rule the real channel would need).
      if (canon(existing.object) === canon(body.object)) return [200, { ok: true, replay: true, serverTime: new Date(nowMs()).toISOString() }];
      return [409, { code: "immutable", message: "object already exists" }];
    }
    const key = user + ":" + dayKey(nowMs());
    const used = state.rate.get(key) || 0;
    if (used >= rule.max) return [429, { code: "rate_limited", message: "rate limit" }];
    const snapBytes = Buffer.byteLength(JSON.stringify(snapshot())) + bytes;
    if (snapBytes > MAX_SNAPSHOT) return [507, { code: "world_full" }];
    state.rate.set(key, used + 1);
    state.objects.set(body.id, { object: body.object, createdAt: nowMs(), authorId: "u_" + user, seq: ++state.seq });
    return [200, { ok: true, serverTime: new Date(nowMs()).toISOString() }];
  }

  async function readBody(req) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    return raw ? JSON.parse(raw) : {};
  }
  function send(res, code, obj, type) {
    res.writeHead(code, { "content-type": type || "application/json", "cache-control": "no-store" });
    res.end(typeof obj === "string" ? obj : JSON.stringify(obj));
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://x");
      if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/harness.html")) return send(res, 200, fs.readFileSync(path.join(here, "harness.html"), "utf8"), "text/html");
      if (req.method === "GET" && url.pathname === "/main.js") return send(res, 200, fs.readFileSync(path.join(bitDir, "main.js"), "utf8"), "text/javascript");
      const user = req.headers["x-user"] || "anon";
      if (url.pathname === "/api/world/get") {
        if (state.down) return send(res, 503, { code: "unavailable" });
        return send(res, 200, snapshot());
      }
      if (url.pathname === "/api/world/mutate") {
        const body = await readBody(req);
        if (state.down) return send(res, 503, { code: "unavailable" });
        if (state.failNext === "before_persist") { state.failNext = null; return send(res, 503, { code: "unavailable" }); }
        if (state.failNext === "auth") { state.failNext = null; return send(res, 401, { code: "unauthorized", message: "session expired" }); }
        const [code, out] = mutate(user, body);
        state.log.push({ user, id: body && body.id, code });
        if (state.failNext === "after_persist" && code === 200) { state.failNext = null; return send(res, 504, { code: "timeout" }); }
        return send(res, code, out);
      }
      // ---- test controls ----
      if (url.pathname === "/api/test/store") return send(res, 200, { objects: Object.fromEntries(Array.from(state.objects.entries()).map(([k, v]) => [k, v])), log: state.log });
      if (url.pathname === "/api/test/clock") { const b = await readBody(req); state.clockOffset = b.offsetMs || 0; return send(res, 200, { now: nowMs() }); }
      if (url.pathname === "/api/test/down") { const b = await readBody(req); state.down = !!b.down; return send(res, 200, { down: state.down }); }
      if (url.pathname === "/api/test/failNext") { const b = await readBody(req); state.failNext = b.mode || null; return send(res, 200, {}); }
      if (url.pathname === "/api/test/inject") { const b = await readBody(req); state.objects.set(b.id, { object: b.object, createdAt: b.createdAt ?? nowMs(), authorId: b.authorId || "u_injected", seq: ++state.seq }); return send(res, 200, {}); }
      if (url.pathname === "/api/test/overwrite") { const b = await readBody(req); const e = state.objects.get(b.id); if (e) e.object = b.object; return send(res, 200, { ok: !!e }); }
      if (url.pathname === "/api/test/reset") { state.objects.clear(); state.seq = 0; state.rate.clear(); state.log = []; state.clockOffset = 0; state.down = false; state.failNext = null; return send(res, 200, {}); }
      send(res, 404, { code: "not_found" });
    } catch (e) {
      send(res, 500, { code: "server_error", message: String(e && e.message) });
    }
  });
  return { server, state, nowMs };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 8787);
  createWorldServer().server.listen(port, () => console.log(`Daily Collective Canvas harness on http://localhost:${port}/?user=alice`));
}
