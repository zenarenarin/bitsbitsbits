# WORDS APART

A timed daily word descent for Plethora (`plethora-bit@2`, three.js 0.164.1).

**Two letters. One word. Five levels. One descent.** Each puzzle shows the first letter, the last letter, and one slot per missing letter. You type the word. All five words share one 75-second clock. Every correct word lowers a stone slab, with a small cloaked traveller standing on it, one level deeper into a single underground world. The fifth word lands the slab in front of a monolith of pale light.

## Play

| | Desktop | Phone |
|---|---|---|
| Type | Type the missing letters. Typing the whole word, fixed letters included, also works | The soft keyboard opens when the descent begins. Tap the letters if it closes |
| Delete | Backspace | ⌫ |
| Submit | Enter. An exact, accepted word submits itself | Go / Enter |
| Nudge | NEED A NUDGE? −5s | same |

- **Wrong word:** the slots shake and the timer keeps running. Your letters stay so you can fix them. An incomplete word never counts as a wrong guess.
- **Nudge:** once per level. It reveals a short clue and takes 5 seconds off the shared clock. A second press does nothing. At 5 seconds or less the button turns into *Too late for a nudge*, so a nudge can never take the clock below zero.
- **Timer:** starts when the first puzzle becomes active and never resets. It keeps running through descents: the next puzzle accepts letters 1.15 s after a correct word, while the camera is still moving.
- **Timer stages:**
  - 30 s: the digits shift to ochre.
  - 15 s: an ember tint and a slow pulse, and the light column breathes.
  - 5 s: a restrained heartbeat.

## Scoring

Per word: `(100 + whole seconds remaining) × streak − 50 if nudged`.

- The **streak** counts consecutive clean words: no wrong guess and no nudge on that word. It runs ×1, ×1.25, ×1.5, ×1.75, ×2.
- **Reaching the bottom** adds `250 + 10 × whole seconds remaining`.
- After each word, a popup shows its points broken down, for example `100 + 62 speed × 1.25 streak`.

## Daily challenge and leaderboard

- **Daily puzzles:** the day number comes from the player's local calendar date; No. 1 is 1 Jan 2026. `dailyPuzzles(bank, day)` walks a seeded permutation of each level's pool, so every player gets the same five puzzles on the same date. No puzzle repeats within a cycle of that level's pool, and the pools have different sizes, so the five-word sets don't repeat in step.
- **The ranked run:** the first daily run on a device is ranked. Its score goes to the platform through `ctx.memory.record('score').submit()`, declared in `plethora.json` as a daily, weekly and all-time global record. The fallback is `ctx.game.score()`.
- **Every later run is practice:** a different random set, never submitted. The failure screen reveals the day's answers, so replays can't be ranked.
- **The in-game Leaderboard panel** shows only this device's history and says so. It does not invent global rankings.

## The puzzle bank

`tools/puzzles.txt` holds 162 hand-written puzzles (`level | answer | hint`), 30 to 34 per level:

| Level | Name | Letters |
|---|---|---|
| 1 | Warm up | 3–4 |
| 2 | Getting warm | 4–5 |
| 3 | Think fast | 5–6 |
| 4 | Deep end | 6–8 |
| 5 | Final descent | 7–9 |

**Choosing the words.** The two letters and the length are all a player gets, so many patterns fit more than one word. Answers for levels 3–5 were chosen so that each pattern has few easy alternatives:

- No endings that inflections satisfy trivially (`-S`, `-ED`, `-Y`).
- The candidate scripts used `wordfreq` to check that no very common word also fits.

**Building the bank.** `tools/build_bank.py` generates `src/01_bank.js`:

- It accepts every word that is in **both** reference dictionaries (npm `word-list` and `an-array-of-english-words`) and has the puzzle's first letter, last letter and length.
- A small blocklist of slurs and vulgarities is removed.
- The primary answer is always first.
- The build fails if an answer is the wrong length for its level, is a duplicate, is missing from the dictionaries, or if its hint contains the answer.

The game never looks words up at runtime. It accepts exactly the baked list: 4,680 accepted words in all. A valid alternative such as `CAP` for `C_P` or `LOCKSMITH` for `L_______H` counts in full. The results screen notes which word the puzzle had in mind.

**Rebuilding:**

```sh
npm i --prefix /tmp/wa-tools word-list@2 an-array-of-english-words
pip install wordfreq
python3 tools/build_bank.py /tmp/wa-tools/node_modules
node build.js
```

## The world

One continuous vertical world, built in `src/04_world.js` from a few reusable pieces placed by hand-tuned rules: chiselled rock, cut stone, slabs, cables, obelisks and grid blocks. These are batched into roughly 15 instanced draw calls. The slab hangs on four cables from a stone beam across the opening.

| Puzzle | Figure's feet | Zone | What's there | Descent after it |
|---|---|---|---|---|
| 1 | y 0 | The surface | A narrow ragged opening; a hard-edged square column of green light; a spiral stair cut into the shaft wall; a fallen monolith | Down the lit shaft, camera above looking along the column |
| 2 | y −70 | Upper chamber | Dressed stone courses, cornice ledges, pilasters, grids of niches (a few lit), a colossal stepped bracket | Past the bracket |
| 3 | y −150 | The midpoint | A cavern: three bridges on piers, hanging stepped pyramids and obelisks, lit portals, a terraced floor funnelling to the passage | Swings out wide over the cavern |
| 4 | y −235 | The deep end | A tight passage of dark masses and pillars, with green light in five cracks | Through the passage, looking up |
| 5 | y −330 | Final chamber | Hanging below a coffered vault | Pulls back to reveal the chamber: colonnade, grid floor, inverted "skyline" of graph-paper blocks, standing stones, a dais and the monolith |

**Lighting by depth.** Fog density, light from above, the key spot, the traveller's lantern and the rim colour are all keyframed along the depth. Light comes from above at the surface. Deeper down, the lantern and the cracks take over. At the bottom, the monolith's slit wakes and a warm beam rises.

**Materials.** All stone shares one `MeshStandardMaterial` patch: world-space value noise for colour variation, strata bands, a moss tint, roughness variation, and a fresnel rim that stands in for edge highlights.

**Film grain** is a CSS layer under the interface, so it never sits over the letters.

**Reference translation.**

- From *BELOW*:
  - the narrow hard-edged column of stippled light;
  - the tiny pointed-hood silhouette (ours carries a staff and lantern);
  - a few pale eyes blinking in the far dark.
- From *Allegory of the Jam Jar*:
  - grid-snapped block masses of varying value, including an inverted skyline under the vault;
  - the incised floor grid and the coffer geometry.

**The camera** (`src/05_director.js`):

- Each puzzle has a composed pose.
- Each descent is a Catmull-Rom move through its own beats, eased in and out.
- A per-height radius clamp keeps the lens inside the architecture.
- `setViewOffset` composes the traveller in the lower part of the frame, under the puzzle.

## Sound

All sound is synthesised with Web Audio (`src/03_audio.js`), started on the first tap, and can be muted from the top-right icon. The setting persists.

- a brown-noise room tone and low drone that deepens with depth;
- rare distant drips;
- stone taps for typing;
- bell-stone chimes that step down in pitch per level;
- a muted thud for wrong guesses;
- an airy shimmer for nudges;
- stone-grinding rumbles for descents;
- a heartbeat under 5 s;
- a bell chord and swell for the finale.

## Performance

- **Instancing:** every repeated piece is instanced. One shadow-casting light (the key spot), and only the slab and the traveller cast shadows.
- **Phones:** 1024² shadows, 160 motes, DPR capped at 2.
- **Adaptive resolution:** after the run starts, if frames average over 25 ms, the DPR drops to 1.25 and then to 1.
- **Cleanup:** everything is disposed in `onDestroy`.

## Source layout

| File | |
|---|---|
| `src/00_util.js` | maths, seeded RNG |
| `src/01_bank.js` | generated puzzle bank |
| `src/02_rules.js` | `CONFIG` (timer, costs and scoring are all tunable here), daily selection, `WordInput`, `Run` (the state machine and the one clock). No DOM |
| `src/03_audio.js` | synthesised sound |
| `src/04_world.js` | the 3D world, lighting, traveller, atmosphere |
| `src/05_director.js` | camera poses and descents |
| `src/06_ui.js` | CSS and DOM |
| `src/07_game.js` | the Plethora entry point: input, flow, HUD, results, persistence, platform calls |

`node build.js` concatenates `src/` into `main.js`, the Bit's entry.

## Run and test locally

```sh
node build.js
mkdir -p dev/vendor && cp <three@0.164.1>/build/three.module.js dev/vendor/
python3 -m http.server 8766        # from this folder, then open http://localhost:8766/dev/index.html
node dev/rules_test.js             # bank + rules: 5,879 checks
node dev/shots.js dev/out phone win     # screenshots of every beat (needs playwright)
node dev/shots.js dev/out desktop lose
```

## Known limitations

- **Global leaderboard view:** the Bit submits to the platform record but has no API to read global rankings, so the in-game panel shows only this device's history. The platform's leaderboard UI is where global ranks appear.
- **One ranked run per day:** this is enforced per device, through `ctx.storage`. Stopping a player from replaying the daily on another device needs a server-side check.
- **Daily date:** uses the device's local calendar date, like most daily word games. If the platform's daily leaderboard period is UTC, use `dayNumber` with the UTC date instead so the two line up.
- **The timer is wall-clock:** it keeps running if the app is backgrounded mid-run. This prevents pausing to think, but it means an interruption costs time.
- **Testing:** the visuals were tuned in headless Chromium with software WebGL. The game still needs a check on real low-end phones, where adaptive resolution is the safety net.
