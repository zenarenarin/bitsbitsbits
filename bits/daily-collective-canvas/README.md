# Daily Collective Canvas

One shared canvas per day. Everyone can **ADD** a mark, **CONTRIBUTE** a response to someone else's mark, or **TRANSFORM** how an existing mark is seen. Nothing committed is erased. At midnight IST (Asia/Kolkata) the day's composition closes and joins a permanent, read-only archive.

Files:

| File | Purpose |
| --- | --- |
| `main.js` | The Bit (`window.plethoraBit`): renderer, gameplay, sync, rollover, archive, HUD. |
| `plethora.json` | Manifest. Declares the shared `objects` world `canvas` with a 40/day/user rate limit and attribution. |
| `harness/server.mjs` | Local stand-in for the platform world plus a static server for the harness. Dev only, not uploaded. |
| `harness/harness.html` | Mock of the documented `ctx` surface the Bit uses. Dev only. |
| `harness/e2e.test.mjs` | 20 Playwright acceptance tests across independent browser clients. |

## How it fits Plethora

A Bit runs inside Plethora's sandbox. It cannot ship its own server, database or sockets, and it has no network egress. The only shared, server-persisted store a Bit has is a declared memory world. So the whole multiplayer model sits on `ctx.memory.world("canvas")`:

- **Storage:** the world is declared `type: "objects"`. Each contribution is written once with `mutate({ id, object })`.
- **Records:** each object is a compact, structured contribution. It holds the type, subtype, geometry in normalized canvas units (1000×1250, a 4:5 canvas), colour, opacity, size, rotation, variant, target ids, transformation params and a client timestamp. Nothing is stored as pixels.
- **Ids:** an id is `YYYY-MM-DD_<nonce>_<checksum>`. The date ties the record to its daily canvas. The nonce makes the id unique, so a retry with the same id is idempotent. The checksum covers the record's content, so a record changed after commit fails validation on every client and is never shown altered.
- **Daily canvases:** these are partitions of that one world by date key, not separate server rows. The archive lists every calendar day from the first canvas to yesterday, including quiet days with no marks. Thumbnails are rendered on demand from the stored records and never stored.
- **Sync:** clients fetch `world.get()` every 4 s, backing off to 30 s while offline. They also refetch on the `online` and `visibilitychange` events. Records are merged by id, so a duplicate or replayed delivery can never draw a mark twice. A record the server has acknowledged stays visible even if a read lags behind.
- **Render order:** the same everywhere. ADD marks first, then CONTRIBUTE responses, then TRANSFORM overlays, then local selection and draft overlays. Within a layer, records sort by the server's sequence or creation time when the snapshot provides one, otherwise by the stored timestamp, with the id as tie-break. Rendering is fully deterministic. Every pseudo-random choice (rough edges, blob outlines, dot scatter) is seeded from the record id, and no client-side randomness is used.

### Gameplay

- **ADD:** freehand (ink, chalk or dotted), shapes (ellipse, rectangle, polygon, organic blob; filled or outlined), line and arc, dot clusters (scatter, ring or row), and 8 drawn stamps (eye, sun, spiral, leaf, moon, star, zigzag, flower). Settings are a full-spectrum colour picker, opacity, size, rotation and a "rough" hand-drawn toggle. Tap to drop a mark, drag to size it. There is no commit step: when you lift your finger the mark settles for 1.5 s with an **Undo**, then saves in the background. Starting the next stroke saves the previous one immediately, so drawing never waits on the network.
- **CONTRIBUTE** (target required; overlapping marks can be cycled through, "2 of 4 here"):
  - **Echo** repeats the target's own geometry 2, 3 or 5 times along the dragged direction, with a scale and turn per step.
  - **Connect** draws a thread, vine or dotted line from the target to a point or a second mark. It stores both target ids.
  - **React** surrounds the target with a halo, rays, an orbit or a frame.
  - Unanswered recent marks get a subtle dotted ring as suggestions.
- Drag-defined responses and transforms (echo, connect, mask, shift) save the same way after the drag. Tint, react and texture preview as soon as a mark is picked, so they take one **Apply** tap; otherwise just selecting a mark would save something.
- **TRANSFORM** (a new record that references its target; the original is never touched):
  - **Tint** applies a translucent colour clipped to the target's exact shape (multiply, screen or colour blend).
  - **Mask** cuts a circular window into the target, or reveals only that window.
  - **Shift** casts a displaced, scaled and rotated impression of the target.
  - **Texture** lays hatch, halftone or stripes over the target's shape.
  - Transforms cannot target transforms. A record may only reference existing marks from the same day, and the checks reject cycles, missing targets and targets from another day. Because each id carries a checksum of its own target list, a valid cycle cannot be built in the first place.

### Viewing

**View** (top bar, or the `v` key) hides every tool and fits the whole canvas to the screen, with just the date, counts and **Done** underneath. It is look-only: touches never draw. It works on today's canvas and on archived days. Escape or `v` closes it.

### Colour

The colour row is a live colour preview plus a continuous hue strip you can drag directly. Tapping the preview opens the picker: a saturation/brightness field for the current hue (muted, pastel, vivid or dark), a large hue strip, a hex field for exact values, and the player's own recent colours. It stays open while choosing and drawing, and closes on **Done**, a second tap on the preview, or Escape. The hue strip and field also respond to arrow keys.

The picker is drawn with CSS gradients, not canvases. Every change goes through one exact `#rrggbb` value, which drives the draft preview, the stored record and every client's render. The chosen colour persists across brushes and reloads.

Colours mix like ink (multiply) so overlaps get richer. Very light colours (luminance above 0.85) are laid on top instead, so they don't vanish into the paper. That choice is computed from the stored hex alone, so it is the same everywhere, and marks made with the earlier palette render exactly as before.

### Daily lifecycle

The date key is computed in `Asia/Kolkata` from a clock corrected by the server's time. If the snapshot or mutation response carries `serverTime`, the client uses it, so a wrong device clock cannot pick the canvas (tested). A client left open across midnight gets a notice and moves to the new canvas. A mark that didn't reach the server before midnight is never written to the closed canvas or moved silently: the player gets "didn't save before midnight" with **Add to today** or **Discard**. A response to an old mark can only be set aside. Save-time checks re-validate the day and the targets.

### States

There are deliberate states for:

- loading
- an empty canvas with a daily loose prompt
- settling with Undo, preview with Apply, "saving N" and "saved" in the status, and not-saved marks outlined on the canvas with Retry and Discard (retries reuse the same idempotency key, and network failures retry by themselves when the connection returns)
- offline and reconnecting
- reaching the daily limit (150 marks per person per day, enforced by the world's rate-limit rule)
- an expired session or a permission error
- rollover
- the archive and read-only historical canvases (tap a mark to inspect it)
- unsaved marks survive a reload (kept in `ctx.storage`, convenience only) and are re-sent with their original ids

## Tests

```
node --test --test-concurrency=1 bits/daily-collective-canvas/harness/e2e.test.mjs
```

Latest run: **20 passed, 0 failed** (about 100 s, headless Chromium). The tests cover:

- **Multiplayer (A):**
  - A commit reaches a second client without a reload, and both render pixel-identical canvases.
  - A replayed delivery doesn't duplicate.
  - Simultaneous commits are both kept, in the same order on both clients.
  - An offline client recovers what it missed.
- **ADD (B):**
  - Every mark type persists its structured geometry and style.
  - Cancelling a draft creates nothing.
  - Long strokes are simplified to fit the 1 KB mutation limit, and oversized payloads are rejected.
  - Tampered records are refused.
- **CONTRIBUTE (C):**
  - Echo, connect and react store correct target ids, connect stores both, and originals are unchanged.
  - Overlapping marks can be cycled.
  - Missing, cross-day and transform-of-transform targets, malformed colours, and geometry out of range are all ignored safely.
- **TRANSFORM (D):** all four transforms change the target's pixels, leave its record intact and render identically on another client. A cancelled preview creates nothing.
- **Rollover (E):** a server clock set to 23:59:40 IST rolls over with an open draft. Nothing moves silently, continuing on the new day is explicit, and yesterday is archived intact. A device clock 5 days wrong does not change the canvas.
- **Archive (F):** quiet days are listed, thumbnails are derived from records, archived days are read-only, and marks can be inspected.
- **Resilience (G):** a lost response is retried with the same id and saved once. An expired session keeps the draft. A draft survives a reload.
- **Colour:** dragging the hue strip and the saturation/brightness field picks a new colour, and the picker stays open while switching brushes and drawing. A colour change updates the settling mark, the exact hex is saved and renders identically on another client, keyboard controls adjust hue, and the colour survives a reload.
- **Interface (H):** proportions hold on phone and desktop sizes, keyboard controls work, the Bit runs with reduced motion, and View enlarges the whole canvas without drawing.

### Manual two-client check

`node bits/daily-collective-canvas/harness/server.mjs`, then open `http://localhost:8787/?user=alice` and `?user=bob` in two windows.

**Rollover without waiting:**

```
POST /api/test/clock {"offsetMs": <ms to 23:59:40 IST minus now>}
```

**Outages:** `POST /api/test/down {"down": true}`.

## What only the real platform can confirm (honest limitations)

The harness implements my reading of the documented contract. These behaviours of the real `objects` world are **not documented** and are **not verified** in Plethora itself:

1. **Snapshot shape.** The client accepts `objects` as an array of `{id, object, …}` or as a map from id to object, and several wrappers around them. If the real shape differs, the canvas will load empty. That would be a quick fix once the shape is known.
2. **Server-authoritative ordering and clock.** The client uses `seq` or `createdAt` per object, and `serverTime` on snapshots, *if present*. Without them, ordering falls back to the stored client timestamp. That is deterministic across clients but not server-assigned. Rollover then falls back to the device clock.
3. **Immutability at the server.** The `objects` world documents `{id, op:"delete"}` and overwrites by id. No declared rule makes a channel append-only. This Bit never sends either, and clients refuse any record whose content no longer matches its checksum. A malicious client could still delete or overwrite through a raw call. **Plethora needs an append-only or insert-only world rule** to guarantee permanence at the server.
4. **Archived-canvas read-only at the server.** Writes for a past date are blocked in the UI and at commit time. The platform has no rule that rejects mutations whose date key isn't the server's current day, so a crafted client could still write to a past date. That needs a server-side rule.
5. **Target validation at the server.** It happens on every client at render time: invalid relations are never drawn. The server does not enforce it.
6. **Capacity.** One world snapshot is capped at **256 KB across all days**. With records of roughly 150–900 bytes, that is a few hundred to about a thousand marks *in total* before writes fail; the UI then shows "not saved". Long-term archives need per-day world partitions (a date-scoped `get`, or one world per day) from the platform.
7. **Realtime.** No push or subscription API is documented, so sync polls every 4 s, which is within the brief's allowed fallback.
8. **Distinct contributors** are shown only when the snapshot carries author attribution on every record (`attribution: true`). No client-supplied identity is ever trusted.

The harness enforces stricter server behaviour than the documented platform: it refuses overwrites of an existing id with different content. Real-platform behaviour there is item 3.

## Deployment

1. Upload as a draft (done via the paired agent token) and open it in Plethora Create.
2. In the draft preview, open it on two devices and confirm marks appear on both within a few seconds. If the canvas stays empty after a commit, the real snapshot shape differs from item 1. Send me one `world.get()` result and it's a one-line fix.
3. Ask Plethora for an append-only or current-day-only world rule (items 3–5) and per-day partitions (item 6) before relying on this as a permanent archive at scale.
4. Publish manually from the app when happy.
