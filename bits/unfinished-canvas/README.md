# The Unfinished Canvas

*Everyone leaves a mark. Nobody gets the last word.*

A persistent, shared canvas for Plethora. Each visit gives a player one contribution
(up to 8 marks, 10 seconds of active drawing) in one of three modes:

- **ADD**: draw a stroke or place a shape stamp anywhere on the canvas.
- **CONTINUE**: pick someone's mark (glowing "loose ends" invite this). Your first stroke
  grows out of that mark, and it inherits the mark's colour and brush.
- **TRANSFORM**: pick a mark and lay something over it so it reads differently. A spotlight
  frames the target, and at least one of your marks has to overlap it.

Nothing can be erased. History lets you scrub the canvas back to its seed marks, replay how it
grew, jump between day snapshots, and tap the same spot repeatedly to dig through covered
layers. None of this changes the live canvas.

## Files

- `plethora.json`: the manifest. It declares the `canvas` objects world (rate-limited to 6
  contributions per user per day on the server), the tuning knobs and immersive onboarding.
- `main.js`: the whole Bit, with no dependencies, rendered in Canvas2D.

## Architecture (sections in `main.js`)

| Responsibility | Where |
| --- | --- |
| Codec: 12-bit absolute + delta point strings, RDP simplification | §3 |
| Contribution validator: rejects malformed, non-finite or out-of-range geometry | §4 |
| Seed marks: built in, labelled, run through the same codec and validator | §7 |
| Repository interface (`load`, `append`): shared world plus a labelled local fallback | §8 |
| Immutable, append-only model, deterministic order, spatial grid for hit tests | §9 |
| Camera and cached art layer (re-rendered only when the view settles) | §10, §18 |
| Draft editor, input (one finger draws, two fingers navigate), budget fitting | §15 |
| Submission: same-id retry, so a retry can't create a duplicate | §16 |
| History and snapshot reconstruction (view-only) | §17 |

A stored contribution looks like this:

```json
{ "v": 1, "m": "a|c|t", "p": "<parentId?>", "t": 1760000000,
  "k": [[0, brush, colour, width, "<points>"], [1, brush, colour, shape, x, y, r, deg]] }
```

It is written with `ctx.memory.world("canvas").mutate({ id, object })`, where `id` is
client-generated and doubles as the idempotency key.

## What is real and what is approximated

- **Shared persistence** uses the Plethora objects world. Its snapshot shape and ordering
  metadata aren't documented, so `normalizeSnapshot` accepts several shapes. Order comes from a
  server sequence number when one is present, then a server timestamp, then the client time.
- **Live sync** re-reads the world every 30 s, when the app returns to the foreground, and
  after a submit. There is no push channel in the SDK.
- **Contribution limit**: one per visit is enforced on the client. The real cap is the
  server-side rule of 6 per user per day.
- **Immutability**: the client never replaces a known id. The objects world itself would
  accept an overwrite of an existing id from a modified client. Production needs an
  append-only, insert-if-absent rule on the server.
- **Capacity**: a world snapshot is capped at 256 KB, roughly 600–900 contributions. Past that,
  the canvas needs server-side tiling or snapshot archiving.
- **Moderation**: nothing is built for it yet. Removal should be an authorised server action,
  never a player tool.
- **Seed marks** are built into the Bit rather than stored in the world.
- **Fallback**: if the world can't be reached, the Bit says so and keeps that visit's marks on
  the device ("this device only").
