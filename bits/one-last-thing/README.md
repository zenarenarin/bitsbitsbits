# ONE LAST THING

A 3D spatial packing puzzle Bit for Plethora (`plethora-bit@2`, three.js 0.164.1). An open wooden drawer and a cabinet of curiosities: glazed vases, a teapot, a brass key, a little gramophone, a thick old journal and more. Fit every piece in the drawer. Nothing may stick out, nothing may pass through anything else, and everything has to rest on something.

Everything is real 3D. The pieces are meshes with real dimensions. Collision, containment and support are worked out in three dimensions. There is no 2D occupancy grid anywhere.

## Playing

| | Touch | Keyboard (desktop) |
|---|---|---|
| Pick up from the shelf | Drag a piece up into the drawer, or tap it to inspect it | |
| Move | One-finger drag (anywhere over the drawer while holding) | Arrow keys (Shift for fine) |
| Turn (vertical axis) | TURN, or twist with two fingers | Q / E |
| Tip (left-right axis) | TIP | W / S |
| Roll (front-back axis) | ROLL | A / D |
| Rotation step | 90° or 15° toggle | |
| Raise / lower (under overhangs) | ▲ ▼ | R / F |
| Place | Release the drag, tap the piece, or PLACE | Enter |
| Put back | Drag onto the shelf, or tap the shelf | Esc |
| Rearrange | Tap a placed piece to lift it | |
| Look around | Drag empty space, pinch to zoom, VIEW to reset | C resets |
| Undo / empty the drawer | UNDO, EMPTY (also undoable) | Z |

While you hold a piece, a translucent ghost shows exactly where it will come to rest, with a dashed drop line. Ochre means it will fit. Vermilion means it won't, and a short line says why: too tall, hanging over a wall, passing through a named piece (that piece is outlined), or not able to stay put. A refused placement never becomes permanent; the piece stays in your hand.

Drawer No. 1 opens with a small worked example: a hand shows the drag, and the tall vase that does not fit upright teaches tipping. Modes: **Fit everything** (default, no timer) and **Beat the clock** (from the menu).

## How it works

`src/` is concatenated into `main.js` by `build.js`. Rendering, interaction and puzzle validation are separate modules.

- **`01_geom.js` Collision primitives.** Box, convex point hull, frustum (optionally elliptical), ellipsoid and capsule, each with an exact support function. Includes an allocation-free GJK distance query that returns the closest points.
- **`03_catalog.js` The collection.** 28 objects across four groups: ceramics, vintage household, paper and stationery, curious objects. Each object is a list of features: lathe profiles, wonky boxes, prisms, tubes, rings, domes and a hollow bowl. The same features build both the visible mesh (`06_render.js`) and the convex collision parts, so collision follows the silhouette:
  - A lathe profile becomes one frustum per profile segment. This is exact for the turned surface; the hand-wobble is bounded and covered.
  - Handles and spouts become capsule chains whose radius includes the chord deviation.
  - The bowl is a ring of wedge hulls, so small things really nest inside it.
  - The radio's knobs, the TV's splayed legs, the gramophone horn, the incense stick and the horse's ears are all real geometry.
- **`02_world.js` The packing world.**
  - Containment comes from the exact support extents of every part.
  - Interpenetration uses broad-phase AABBs, then GJK on part pairs.
  - The gravity drop is conservative advancement, exact for convex pairs under translation.
  - Contacts are sampled in a cone around each contact normal.
  - Stability is the centre of mass against the support polygon. Leaning is allowed when tipping is genuinely blocked by a wall or a neighbour.
  - `settle` drops, tips about the support edge, or slides off steep contacts until the piece is at rest. Each step is recorded so the mesh replays the real settle path.
  - `restingOn` simulates lifting a piece out and reports anything that would lose its support. Stacks and leaners are protected: you lift the top piece first.
- **`04_packer.js` + `08_levels.js` Solvable levels by reverse generation.**
  - The packer places objects with the same drop, settle and validation rules the player faces. It tries extreme-point candidates and every distinct axis orientation.
  - It binary-searches the smallest drawer depth that still packs, then adds the level's slack.
  - The arrangement it found is kept as a proof.
  - The 12 designed drawers are solved offline (`dev/gen_levels.js` writes `08_levels_data.js`).
  - Endless drawers vary the objects (8 to 14), their sizes (±10%) and the drawer. They are generated on the device in small time slices while you play the previous drawer.
  - `Packer.verify` rebuilds every proof from its stored poses and re-validates it before the puzzle is shown. An unverified puzzle is never presented.
- **`05_paint.js` Procedural gouache, painted onto real 3D geometry.**
  - Layered washes, tapered brush strokes, dry-brush streaks and speckle.
  - Glaze that pools and drips over the clay body.
  - Hand-wobbled ink motifs: diamonds, suns, circles, zigzags, dots.
  - Bold wood grain; brass with painted glints instead of a metallic gradient.
  - Paper with fibres, foxing and handwriting.
  - Faces for the radio, TV, portrait, clock dial, chest, journal, postcards and mask.
- **`06_render.js` Rendering.**
  - Toon shading with a soft gouache ramp, material-specific painted highlights, edge darkening, contact occlusion toward the drawer floor and paper grain.
  - Inverted-hull ink outlines with a wobbling, screen-constant width.
  - A real wooden drawer with walls, a felt lining with a stitched border, a brass bail pull, a keyhole and a label card that shows the interior size.
  - Warm key light with soft shadows, a cool fill, and a separate orthographic catalogue shelf.
- **`07_audio.js` Synthesised material sounds.** Ceramic clink, glass ring, wood knock, muted brass, paper rustle, book thud, plus pickup, refusal and turn sounds. A quiet generative music-box bed plays underneath, and a chime marks the final piece.
- **`09_game.js` Game.** Input (pointer, multitouch, keyboard), the hold, settle and place flow, undo snapshots, the results card, menus, onboarding and persistence. Persistence uses `ctx.storage` and Continue Playing progress. The `drawers` leaderboard records the highest drawer packed.

## Run locally

```sh
node build.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/three.module.js https://libs.plethora.studio/three/0.164.1/three.module.js
python3 -m http.server 8765        # from this folder, then open http://localhost:8765/dev/index.html
```

## Tests

```sh
node dev/test_geom.js       # GJK against analytic distances, capsule fuzz, catalogue dimensions
node dev/test_world.js      # containment, overlap, drop, stacking, toppling, nesting in the bowl, validation
node dev/test_pack.js       # packer timing on growing sets
node dev/test_endless.js 8  # endless drawers generated and verified; all designed drawers re-verified
node dev/gen_levels.js      # re-solve the designed drawers (writes src/08_levels_data.js)
node dev/acceptance.js [shotDir]   # the brief's scenarios A-L in headless Chromium with real pointer input
node dev/flow.js <dir> / dev/flow2.js <dir>   # scripted play-throughs of drawer 1 with screenshots
node dev/gallery.js out.png [ids]  # every object laid out for art review
```
