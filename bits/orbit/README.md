# ORBIT

A daily colour-alignment puzzle Bit for Plethora (`plethora-bit@2`, Canvas2D and DOM, no dependencies).

There are five concentric rings with twelve 30° segments each. The centre ring is the fixed reference. You turn the other four until every hue family lines up in radial columns. Each solve reveals the name of that puzzle's visual universe and adds it to your collection.

## Play

- **Drag** a ring to turn it. The rotation uses the angle around the board centre, unwrapped so that crossing 12 o'clock or 9 o'clock never jumps. On release the ring eases out to the nearest 30° step, with no overshoot.
- **Tap** a ring to select it. ↺ and ↻ buttons appear and turn it one segment per tap.
- **Keyboard:** ↑ and ↓ choose a ring, ← and → turn it, Z undoes.
- **Hint** shows which way to turn the ring nearest to alignment.
- **Undo** reverts the last action and removes its moves. **Restart** asks for confirmation.
- A move is one segment, so a three-segment drag counts as 3. **Par** is the fewest possible moves.

## Modes

- **Daily:** one puzzle per local calendar date, numbered from 1 Nov 2026 (No. 1). It always has five rings. It is seeded by the date, so everyone gets the same board, and reloading keeps it. Your time goes on the `solve_time` board (ascending, daily/weekly/all-time). Your streak goes on `streak`.
- **Studies:** endless numbered levels. Studies 1–2 are easy (3 movable rings). From Study 3 they are mostly medium, and from Study 7 every third one is hard (5 movable rings).
- **Collection:** every solved universe as a miniature. You can open any of them back on the board.

## Architecture (`src/`, concatenated into `main.js` by `build.js`)

| File | Role |
|---|---|
| `00_util.js` | Seeded RNG, easing, angle unwrapping, OKLCH colour maths, calendar |
| `01_puzzle.js` | `PuzzleGenerator` (deterministic, difficulty-checked) and the engine. The engine is the single source of truth for ring positions, alignment maths, undo and hints. |
| `02_themes.js` | Theme engine: registries of colour universes, materials, grounds, separations and completion styles, plus visual QC |
| `03_render.js` | GameBoard, OrbitRing and RingSegment vector rendering, material and lighting passes, ground, hub, theme-reveal transition, thumbnails |
| `04_audio.js` | Synthesised sound: drag detents, snap, a per-ring bell, the completion chord, and an ambient bed through `ctx.music` |
| `05_score.js` | ScoreManager: profile (streak, bests, collection, studies) in `ctx.memory.local` with a device cache, and leaderboard records |
| `06_ui.js` | DOM HUD: header, controls, step buttons, completion screen, collection |
| `07_main.js` | Layout, input, animation, game flow and SDK wiring |

Themes never touch the puzzle. A theme only says how hue family *i* of ring *k* looks.

### Adding a visual universe

Call `U({...})` in `02_themes.js` with these fields:

- a palette law (`wheel`, `arc`, `ramp` or `optical`), with parameter ranges
- the compatible materials, grounds and separations
- names
- a one-line blurb

Every assembled theme must pass QC:

- neighbouring segments at least 0.042 apart in OKLab, and any two families at least 0.03 apart
- enough contrast between the board and the ground
- WCAG 4.5:1 for interface ink

A theme that fails is redrawn deterministically. `ThemeRegistry.registerAuthored(key, spec)` pins a hand-directed edition.

There are 22 universes, 12 materials, 10 grounds, 5 ground patterns, 6 separations and 4 completion styles. Consecutive editions never share a universe.

## Develop

```sh
node build.js
python3 -m http.server 8777      # from this folder
# open http://localhost:8777/dev/index.html  (fonts: see dev/vendor note below)
```

`dev/vendor/` holds the three approved registry fonts, downloaded from `libs.plethora.studio`, for the local harness. It is git-ignored.

## Tests

```sh
node dev/test_puzzle.js              # 12,000 generated puzzles: determinism, difficulty, solvable to par, engine semantics
node dev/test_themes.js 1500         # 3,000 themes: QC, no consecutive repeats, determinism
node dev/play.js dev/out [touch]     # real pointer/touch drags in Chromium: seam crossing, snapping, undo, tap controls, solve, records, share, studies
node dev/coll.js                     # reload restore, collection, gallery, studies progress
node dev/perf.js                     # board render cost per frame
node dev/sheet.js out.png universe 0 24   # contact sheet of universes
```
