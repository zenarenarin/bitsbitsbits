# The Unfinished Canvas

*Everyone leaves a mark. Nobody gets the last word.*

A persistent, shared canvas for Plethora. Tap **CONTRIBUTE** and you are drawing straight
away: pick a tool and any colour, paint anywhere, preview the result, then add it to the
canvas. Accepted contributions can never be erased or edited.

## How it plays

- **Free draw by default.** CONTRIBUTE opens a draft in DRAW mode. Switch to MOVE to pan
  with one finger. Two fingers always pan and zoom, and a pinch never leaves a stray mark.
- **Six tools**, each with its own behaviour:
  - **Ink**: crisp and opaque.
  - **Neon**: a sharp core with a restrained additive bloom.
  - **Liquid**: translucent, building up colour through screen blending.
  - **Spray**: droplets sampled over time, so holding still builds density.
  - **Ribbon**: a calligraphic nib whose width follows the stroke's direction, with tapered
    ends.
  - **Stamp**: seven shapes. Drag after touching down to set size and rotation.
- **Full-spectrum colour.** A hue strip and a saturation/brightness area, with a live swatch,
  the hex value and a brush preview. The tool icons recolour as you drag. The picker stays open
  until you tap Done, and the exact hex value is what gets stored.
- **Draft → Preview → Add to canvas.** Preview shows the draft over the live artwork exactly as
  it will land, with *Edit again*, *Cancel draft* and *Add to canvas*. If a submit fails, the
  draft is kept for a retry. Cancelling only removes the draft.
- **Building on others is optional.** "Build on a mark" links the draft to someone's mark as a
  **Continue** (inherits its colour and tool; a stroke started near the mark grows out of it) or
  a **Transform** (starts from the complementary colour, with a spotlight on the target). If the
  draft doesn't touch the linked mark, it is saved as a plain ADD; it is never blocked.
- **History.** Scrub back to the seed marks, replay how the canvas grew, jump between day
  snapshots, and tap the same spot repeatedly to dig through covered layers. History never
  changes the live canvas.
- **Budgets** (all creator tuning knobs): 5 contributions per visit, 10 marks and 15 seconds of
  drawing per contribution. The server also caps contributions at 20 per user per day.

## Rendering layers

1. Background.
2. Committed contributions, in one authoritative order, cached offscreen.
3. The draft or preview.

The draft never touches layer 2. Submitting appends to the committed collection and only then
clears the draft. The loop also repaints on a 500 ms heartbeat and whenever the canvas's
backing size changes, so a canvas cleared by the host is always rebuilt.

## Fixed: why drawings appeared to vanish

1. **Mixed ordering keys.** An accepted mark was ordered by a local timestamp while older marks
   were ordered by server sequence or client time. That put the new mark *underneath* existing
   ones. Every contribution now shares one ordering key.
2. **Snapshot parsing.** The world snapshot format isn't documented, and a wrapper shape the
   parser didn't know produced an empty canvas after a reload. The parser now finds
   contributions anywhere in the snapshot, and each object carries its own client id (`i`), so
   one mark can't be split in two by a different server key.
3. **Local fallback without storage.** When storage wasn't available, the fallback re-read an
   empty store on every load. It now keeps an in-memory copy and labels itself "this visit
   only" when nothing can persist.

Tap the status line under the title to open a small diagnostics card. It shows the store, the
last load and write, the snapshot shape, and whether your last mark was confirmed in the
server's snapshot.

## Data

Each contribution is written with `ctx.memory.world("canvas").mutate({ id, object })`, where:

```json
{ "v": 2, "i": "<clientId>", "m": "a|c|t", "p": "<parentId?>", "t": 1760000000,
  "k": [[0, tool, "rrggbb", width, "<points>"], [1, style, "rrggbb", shape, x, y, r, deg]] }
```

Points use a 12-bit absolute-then-delta encoding. Strokes are simplified (Spray strokes are
thinned instead) until a contribution fits Plethora's 1 KB mutation cap. Older v1 objects
(palette indices) still load.

## What is real and what is approximated

- **Persistence** uses the Plethora objects world. **Sync** re-reads it every 30 s, when the app
  returns to the foreground, and after a submit; the SDK has no push channel.
- **Immutability** is enforced by the client, which never replaces a known id. The objects
  world itself would accept an overwrite of an existing id from a modified client. Production
  needs a server rule that only allows inserting new ids.
- **Capacity**: a world snapshot is capped at 256 KB, roughly 600–900 contributions. Past that,
  the canvas needs server-side tiling or archiving.
- **Moderation**: nothing is built for it yet. It should be an authorised server action, never a
  player tool.
- **Seed marks** are built into the Bit rather than stored in the world.
