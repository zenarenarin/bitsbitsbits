# ORBIT

A daily circular logic puzzle Bit for Plethora (`plethora-bit@2`, Canvas2D and DOM, no dependencies).

There are five concentric rings of twelve 30° segments. The centre ring is fixed and carries the twelve colour families in spectrum order, clockwise, so it doubles as the legend. The other four rings turn independently, and each holds the same twelve families in its own order.

An **intersection** is one of the twelve radial columns (labelled by clock hour, XII to XI). A **clue** sits at one intersection. It pins some of the rings and states a rule about the colours they show there. The puzzle is to find one arrangement in which every clue holds at once.

## The progressive reveal

| Stage | Clues | Opens when |
|---|---|---|
| 1 · Discovery | 3 | — |
| 2 · Revelation | +2 (5) | all 3 hold at the same time |
| 3 · Convergence | +2 (7) | all 5 hold at the same time |

A stage advances only on puzzle logic: never on moves or time. Earlier clues stay active and can break again. The generator guarantees that the arrangement a player naturally reaches at each stage, the nearest one, breaks at least one of the newly revealed clues. So every reveal forces a rethink. All clues come from one verified solution.

## Clue types

Each rule is a predicate on family IDs (0–11). Appearance never enters into it. "Steps" are counted round the centre ring.

| Type | Rule |
|---|---|
| Triple | the three pins show one family |
| Pair | exactly one equal pair among the pins; every other pin differs |
| Contrast | the two pins are at least *d* steps apart (*d* = 4, 5 or 6; 6 means opposite) |
| Odd one | the round pins all show one family and the diamond pin shows another |
| Sequence | inside out, each pin is the next family clockwise (or anticlockwise) |
| Missing | family *f* appears on none of the pins |
| All different | every pin shows a different family |

## Play

- **Drag** a ring to turn it. The angle is unwrapped across the 0/360 seam. On release the ring eases to the nearest 30° step, with no overshoot.
- **Tap** a ring to select it for the **Turn** buttons. A tap also outlines that colour everywhere on the board, so a match can be checked by eye.
- **Tap a marker or chip** to focus its clue. The caption shows the rule and the board briefly recedes around that column.
- **Hint** escalates on the focused clue:
  1. which rings it reads
  2. the relationship, read against the board now
  3. a direction worth exploring

  It never moves a ring for you.
- **Undo** reverses exactly the last action and its moves. **Restart** asks for confirmation; revealed clues stay revealed.
- **Keyboard:** ↑ and ↓ choose a ring, ← and → turn it, C cycles clues, H gives a hint, Z undoes.
- **Moves:** one move is one segment of one ring, so `moves` always equals the total steps in the history.
- **Par:** the length of the best progressive route, measured by the solver. **Budget:** generous, and over it costs a star but never ends the game.
- **Stars:**
  - one for solving
  - one for moves ≤ 1.25 × par + 2
  - one for no hints within the time allowance

## Generation and the solver

The state is the four movable offsets: 12⁴ = 20,736 arrangements. Every puzzle is checked exhaustively.

1. **Plan the solved board.** Pick seven distinct columns and a mix of clue types, and fill the pinned cells so that each clue is true. Fill the remaining cells with the families each ring has not used yet. Rings never contain three spectrum neighbours in a row, and no two rings coincide in more than three places at any relative turn.
2. **Scramble.** Choose a solution turn per ring. The ring sequences are the solved board turned back by it.
3. **Measure each clue.** Compute the set of arrangements it accepts (as a bitset).
4. **Split the clues into stages.** All 210 ways of splitting the seven clues 3/2/2 are measured. A split is kept only if:
   - each stage's set size is in band
   - each stage narrows the previous one enough
   - no clue is redundant within its stage
5. **Choose a start.** Breadth-first search gives the distance to each stage's set. The start must:
   - satisfy at most one stage-1 clue
   - need at least three rings turned
   - have par in band
   - pass the rethink rule: the nearest stage-1 arrangements break a stage-2 clue, and so on

Presets (`gentle`, `standard`, `deep`) differ only in these measured bands, not in clue counts. Daily puzzles are `standard`. Practice 1–2 are `gentle`, every fourth practice puzzle is `deep`, and the rest are `standard`. Generation takes about 50 ms on average (worst case about 250 ms over a year of dailies).

## Modes

- **Daily:** one puzzle per local date, numbered from 1 Nov 2026 (No. 1). It is seeded by the date, so everyone gets the same board, and reloading keeps it. Progress resumes. Your time goes on the `solve_time` board, your streak on `streak`.
- **Practice:** endless numbered puzzles.
- **Collection:** each solved puzzle keeps its visual universe and the composition it resolved into.

## Visual system

Themes never touch the puzzle. A theme only says how family *i* looks. For this game:

- **One colour per family.** A family must read as the same colour on every ring (cross-ring drift ≤ 0.03 in OKLab).
- **Distinct families.** Any two families must stay at least 0.085 apart anywhere on the board. Neighbouring hues alternate light and dark to achieve this.
- **A true spectrum.** Only universes whose families form a true colour circle are dealt to puzzles: the 9 wheel universes plus Op Art. The arc and ramp universes stay in the registry for later.

## Architecture (`src/`, concatenated into `main.js` by `build.js`)

| File | Role |
|---|---|
| `00_util.js` | Seeded RNG, easing, angle unwrapping, OKLCH colour maths, calendar |
| `01_puzzle.js` | Condition library, generator, BFS solver and the engine. The engine is the single source of truth for rings, moves, stage and hints. |
| `02_themes.js` | Theme engine: universes, materials, grounds, separations, completion styles, and visual QC including puzzle legibility |
| `03_render.js` | Board rendering (rings, materials, light), clue markers and pins, column focus, family highlight, hub, transitions, thumbnails |
| `04_audio.js` | Synthesised sound: detents, snap, a bell per satisfied clue, the stage reveal, the completion chord, an ambient bed |
| `05_score.js` | Profile v2 (streak, results with stars, collection, practice) and leaderboard records |
| `06_ui.js` | DOM HUD: header, clue caption and chips, stats, controls, completion screen, collection |
| `07_main.js` | Layout, input, reveal choreography, game flow and SDK wiring |

## Develop

```sh
node build.js
python3 -m http.server 8777      # from this folder
# open http://localhost:8777/dev/index.html
```

`dev/vendor/` holds the approved registry fonts for the local harness. It is git-ignored.

## Tests

```sh
node dev/test_puzzle.js 100        # rule definitions, BFS vs brute force, 300 generated puzzles: every guarantee above, solvable through all stages, engine semantics
node dev/test_themes.js 600        # 1,200 themes: QC (incl. legibility), no consecutive repeats, determinism
node dev/play.js dev/out [touch]   # acceptance: a full daily played with real drags through all 3 stages; mechanics, hints, undo, restart
node dev/coll.js                   # reload restore, collection, gallery, practice progress
node dev/layouts.js dev/out        # small-phone and wide screenshots
node dev/perf.js                   # frame cost with clues, pins and focus
node dev/gen_stats.js standard 30  # generator report
```
