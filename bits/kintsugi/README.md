# KINTSUGI

A Plethora Bit (`plethora-bit@2`, three.js 0.164.1). A ceramic object breaks in front of you. Fit every shard back by its shape and turn, then trace each crack with a limited measure of liquid gold. The finished object turns slowly under the lights; how cleanly you worked shows in the seams.

## Play

| | Touch | Mouse / keyboard |
|---|---|---|
| Pick up and move a shard | Drag it | Drag it |
| Turn a shard | Twist with a second finger, or drag the knob on its ring | Drag the knob, mouse wheel, Q / E |
| Turn the object | Drag on empty space | Drag on empty space |
| Lay gold | Drag along a crack, starting on the object | Same |

A shard seats only when its position, its turn and the side of the object facing you are all right (the gap must face you: turn the object first). Close but wrong, it is refused with a small nudge. The gold allowance is the crack length times a level factor; gold laid off the crack spills (and fades), and resting your finger pools it.

## Design

- **Objects** (`src/01_objects.js`): eight surfaces of revolution from hand-drawn profiles with angular modulation: a cup, bowl, plate, vase, candle holder, fluted vessel, moon jar and a folded sculptural vessel. Each has its own glaze tint, speckle, throwing rings and camera elevation.
- **Fracture** (`src/02_fracture.js`): a warped, weighted Voronoi field over the (u, v) surface, with the foot piece (label 0) as a line seed so it stays on the plinth. Islands are merged so every shard is one piece, and sizes are validated (a pattern is regenerated with the next seed until it passes). Marching triangles on the differences of distance fields give crack curves that neighbouring shards share exactly. Every shard is a real solid: glazed outer and inner skins, unglazed flat-shaded fracture walls, and a five-row rounded lip. The crack graph is chained into seams between junctions and the lip, smoothed and resampled every 4.5 mm.
- **Materials** (`src/03_materials.js`): glaze colour, roughness and bump maps are generated into typed arrays (mottling, glaze pooling, iron specks, unglazed foot ring, throwing rings, orange peel). Glaze is `MeshPhysicalMaterial` with clearcoat. The studio is a PMREM-filtered room of soft boxes (key, strips, top, back rims, warm floor bounce). Gold is `MeshStandardMaterial` (metalness 1) with a shader patch: each sample has its fill time, the ribbon grows outward from the crack, and it moves from wet (rough 0.045, rippling normals) to cured (rough set by the final score).
- **Sound** (`src/04_audio.js`): all synthesised through a generated room impulse. Porcelain taps are a filtered transient plus inharmonic partials; gold is silky filtered noise with a faint shimmer that follows stroke speed; completed seams ring pentatonic bells; an ambient bed opens up as the repair progresses.
- **Game** (`src/06_game.js`): `intro → breaking → assembly → gold → reveal → results`.
  - Break: loose shards fly on a damped spring from a burst velocity (heavier pieces move less) into a tray laid out in screen space by best-candidate placement, each turned to show its glazed face (`R_roll(θ) · R_y(−φ)`).
  - Placement: errors are measured on screen (position, as a fraction of object size), on the turntable (yaw) and in the screen plane (roll); a soft magnet engages close in. The held shard renders in a second pass over the object so it never clips into it.
  - Gold: one raycast per frame against a low-resolution proxy; the nearest seam sample comes from a 5 cm spatial hash. Samples between consecutive contacts on the same seam fill continuously, liquid runs three samples ahead, and small gaps on a nearly finished seam close by themselves.
  - Score: precision (placement 40 %, gold deviation 60 %), flow (strokes, stops, time off the crack), efficiency (crack length over gold used) and completion, combined into one number and a grade: Perfect, Excellent, Beautiful, Repaired.
- **Platform**: `display: fullscreen`; UI inside `ctx.contentSafeArea`; `ctx.game.progress` channel `atelier` (unlocked level, best score and grade per object, saved at the end of each level) mirrored to `ctx.storage`; leaderboard record `repair` with an `object` dimension; `ctx.pulse.complete` on each result.

## Run locally

```sh
node build.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/three.module.js https://libs.plethora.studio/three/0.164.1/three.module.js
python3 -m http.server 8766    # from this folder, then open http://localhost:8766/dev/index.html
```

## Tests

```sh
node dev/frac_test.js                       # every level fractures into valid shards and seams
node dev/gallery.js <outdir> [0,1,...]      # intro frame of each object
node dev/bot.js <outdir> [level] [skill]    # plays a level through real pointer events: turn, carry, rotate, trace gold
```
