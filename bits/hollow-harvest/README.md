# HOLLOW HARVEST

A pixel-art Halloween survival arcade Bit for Plethora (`plethora-bit@2`, plain 2D canvas, no dependencies). It is Halloween evening in an endless red cornfield, and something impossibly tall is walking behind the corn. You can't fight it. You can run, and you can hide.

## Controls

One finger, or one key. Mouse works too.

| | Touch / mouse | Keyboard |
|---|---|---|
| Run | Hold anywhere | Hold Space, → or W |
| Hide | Let go within reach of cover (a **HIDE** tag appears) | Release |
| Walk | Let go anywhere else | Release |
| Pause | Pause icon, top right | Esc or P |

Menu buttons act on release over the same button, so a finger still down from the last screen never triggers the next one. Touch cancel, pointer-capture loss and window blur all release the hold.

## The loop: run, hide, recover, run again

Three systems feed each other: movement and stamina, the creature's **awareness**, and concealment. The creature's awareness (what it knows) and its distance (where it is) are separate numbers.

### Movement and stamina (`TUNE` in `src/05_game.js`)

| | Speed | Noise | Stamina |
|---|---|---|---|
| **Hold: run** | 6.2 m/s, rising to 7.8 | loud | −8.5/s (more later) |
| **Release in the open: walk** | 2 m/s | quiet | +1/s, barely |
| **Release in cover: hide** | still | silent | +22/s (a few seconds to refill) |
| **Exhausted** (stamina 0, until 25) | 60% run speed | loudest | heavy breathing, bent posture |

- Running always makes real progress. It doesn't bring the creature closer by itself; it makes you **heard**.
- You're never stopped, even when exhausted, so you can still reach cover.
- Score is ground actually covered; it doesn't grow while hidden or after death.

### Awareness (0–100, never shown as a number)

- **Rises with noise** (running 14/s, exhausted 20/s, walking 3/s), scaled by how close the creature is (×0.5 far to ×1.8 near). Also raised by:
  - standing exposed near it;
  - collisions (+15 minor, +25 major);
  - running through crows (+20);
  - bolting from cover next to it (+30).
- **Falls** in the open when you're quiet, and faster in cover (6/s plus 10/s × the cover's concealment). It falls more slowly while the creature is searching nearby.
- **Overstaying** cover past its comfort time makes it creep up again: camping draws the creature in.
- **Bands:** UNAWARE (0–25), SUSPICIOUS (26–50), HUNTING (51–75), DETECTED (76–100). Players read them from the creature's behaviour, the sound and the screen, not from a number.
- **Last known position:** the creature keeps the last place it heard you, refreshed each time it hears you. The less aware it is, the less precise that position, up to 5 m off. Sneaking (walking) into cover leaves it a stale, vague position, so its search may miss you.

### The creature (`updateCreature`)

It has a real position on the path and only ever moves toward a target at a speed. It never teleports.

| State | Mode | Behaviour |
|---|---|---|
| FOLLOWING | `follow` | keeps 32 m back (closing to 14 m as the run goes on), barely moving, sometimes sinking into the crop |
| INVESTIGATING | `investigate` | from SUSPICIOUS: walks to the last known position (4.8 m/s, 6.6 m/s when hunting); gives up if awareness drops below 20 |
| SEARCHING | `search` | at that spot: slows, looks around, and checks cover around it one reach at a time |
| CHASING | `chase` | DETECTED and in sight: comes straight on at 8 m/s; a short low sting plays when it first spots you |
| LOSING INTEREST | `lose` | search over: turns and walks away (a soft "safe" cue) |
| RETURNING | `ret` | drifts back into the field behind you |

**Discovery.** A check only matters if it's aimed at your cover (within 1.6 m).
- **Warning:** before it resolves, its hand visibly reaches in for 0.9 s, the cover shakes, an alarm sounds and **MOVE NOW** appears.
- **Chance:** (1 − concealment) × (0.3 + 0.7 × awareness) × (1 + 0.6 per second overstayed).
- **Breaking cover:** right under it, it sees you; within 8 m, it hears you and turns.

### Cover (`HIDE_SPOTS` in `src/01_world.js`)

| Cover | Concealment | Comfort | Reach | Hidden as |
|---|---:|---:|---:|---|
| Dense corn | 0.75 | 5 s | inside the clump | crouched among the stalks, in shade, extra stalks closing in front |
| Haystack | 0.50 | 4 s | 0.8 m | behind the stack, in shade |
| Abandoned cart | 0.55 | 4.5 s | 0.8 m | crouched behind the tarp |
| Hollow tree | 0.80 | 6 s | 0.9 m | inside; only the eyes show |
| Small shed | 0.85 | 7 s | 1.0 m | inside the doorway; only the eyes show |

- **Before you hide:** cover in reach glints, and a small outlined **HIDE** sits beside the object with pips showing its comfort time.
- **Hiding:** you slow, half-kneel and settle onto the cover's hiding point. A brief **HIDDEN** label appears.
- **While hidden:** the pips count down, and turn red when you overstay or a check is aimed at you.
- **Measured on the rendered frame:** about 17% of the coat shows in corn, and none behind a haystack or cart or inside a tree or shed.
- **Placement:**
  - Cover is never more than 40–50 m apart.
  - No obstacle is placed inside a hiding place's reach, and farm debris is never stacked on cover.
  - Some sections are sheltered (two hiding places), others exposed.

### Obstacles (`OBSTACLES`)

- **Hitboxes**:
  - Each obstacle has an extent along the path and a height band above it.
  - The traveller's body is tested against that band each step while they overlap. Vaulting raises the body, ducking lowers it.
  - Each obstacle can collide at most once.
- **Committing**: a step before an obstacle, the traveller commits based on how they are moving.
  - Running with stamina: vault low obstacles and leap pits.
  - Walking: step over low obstacles and duck under snags.
- **Collisions** cost stamina and time, and the crash is **heard**: awareness jumps and its last known position snaps to you. The creature is never moved by a collision.

| Collision | Penalty |
|---|---|
| Low (pumpkin, root, fallen board, fallen log), running winded | trip 0.55 s, −8 stamina, awareness +15 |
| Snag (barbed wire, harrow tines at chest height), running | snagged 0.85 s, −12 stamina, awareness +25, then duck through |
| Pit, walking or winded | fall 1.1 s, −12 stamina, awareness +25, climb out |

One-line hints appear the first time you meet a pit, a snag or crows.

### Events (`EVENTS`)

- A scheduler fires one event every 5–9 s. Each event has its own cooldown.
- Nothing decorative fires while the creature is within 12 m or searching.
- **Atmospheric**:
  - bats crossing;
  - a scarecrow turning its head to follow you;
  - a pumpkin lighting up;
  - corn stirring with no wind;
  - the windmill stopping with a creak;
  - a figure on the ridge;
  - a cloud shadow darkening the field.
- **Gameplay (crows)**: crows peck on the path. Run through them and they burst up cawing, and the creature gains 3 m (and turns back if it was leaving). Walk past and they only hop aside.

### Difficulty and pacing

- **Driven by ground covered**, ramping between 80 m and 500 m.
- **The field also closes in with time**, so creeping or camping doesn't stall it.
- **Opening:**
  - The creature starts 38 m back and unaware.
  - The first two hiding places are corn, then a haystack.
  - Continuous running gets you investigated after about 15 s and caught after about 24 s.
- **Later, it's not just speed:**
  - the creature follows closer;
  - background awareness rises faster;
  - comfort times shrink by 25%;
  - long-lasting cover gets rarer;
  - cover gets further apart;
  - harder sections unlock;
  - crows get more frequent.

### Game states

- **Screens** (`MODES`): MENU, STARTING, PLAYING, PAUSED, CAUGHT and GAME_OVER.
  - Changes go through `setMode`, which refuses any transition not in `TRANSITIONS`.
  - The simulation steps only in STARTING and PLAYING. In PAUSED, CAUGHT, GAME_OVER and MENU nothing moves, scores or collides.
- **STARTING** waits for the first hold (the tap that started the run doesn't count). After 6 s it starts without you.
- **Player states** (`playerState()`) are RUNNING, WALKING, HIDING and EXHAUSTED. They're derived from the simulation, so they can't disagree with it.
- Restarting rebuilds the run in place without reloading.

## Rendering and performance

- **Rendering**: the whole picture is drawn with integer `fillRect`s into a low-resolution buffer (about 130×280 on a phone). That buffer is blitted with `imageSmoothingEnabled = false` at the largest whole-number scale that covers the screen. Other screen shapes show more field instead of bars, and the artwork is never stretched unevenly (checked by `dev/fill.js`). There's no anti-aliasing and no gradients (ordered-dither seams only).
- **Danger** is shown by hard-edged burgundy bands at the frame edges and a faint tint, never over the centre. A 1 px stride bob plays while sprinting, and the camera is still in cover.
- **The creature's approach** is one continuous mapping from distance to size (39 px tall at 40 m, about 119 px at its closest) and position. A stepped crop line hides it below the stalk tops at its depth, and the corn sways around it as it wades through. `dev/approach.js` checks for jumps.
- **HUD:**
  - DISTANCE in the large font, BEST under it, and the pause icon top right.
  - A STAMINA bar that shows full, spending, critical (flashing) and recovering (warm, with a moving glint).
  - One short outlined label at a time, in a lane in the sky under the HUD: HIDE NEARBY, THEY'RE CLOSE, EXHAUSTED, STAY STILL, KEEP MOVING, MOVE NOW, HIDDEN.
- **Allocation**: world features, particles and flyers come from fixed pools, and the creature's draw options are reused, so play doesn't allocate per frame.
- **Measured** (`dev/perf.js`) at phone size with a bot playing in real time:
  - Unthrottled: about 1 ms to draw and 0.03 ms to simulate per frame.
  - With the CPU throttled 4×: about 4 ms to draw and 0.1 ms to simulate.
  - In both cases the 95th-percentile frame was 16.8 ms and the heap didn't grow.

## Build and run

```sh
node build.js                         # concatenates src/*.js into main.js
python3 -m http.server 8765           # from this folder, then open http://localhost:8765/dev/index.html
```

`dev/index.html` is a small stand-in for the Plethora runtime.

## Checks

```sh
node dev/scenarios.js           # mechanics scenarios A-I, obstacles, concealment measured on screen, states, input, persistence (44 checks)
node dev/approach.js <outdir>   # the creature's approach is continuous (size, position, crop line), plus a contact sheet
node dev/look.js <outdir>       # frozen screenshots: HUD, each hiding interaction while it searches, a check on you, chase, exhaustion
node dev/fill.js <outdir>       # the picture covers the whole screen on phone, tablet, desktop and landscape shapes
node dev/gen.js                 # 20 km x 20 seeds: every cover type appears, cover gaps, obstacle spacing, nothing in cover's reach
node dev/bot.js [runs]          # strategies through the real step function: hold forever, walk only, camp, a sensible player
node dev/perf.js [throttle]     # frame cost while a bot plays in real time (CPU throttle, default 4x)
node dev/persist.js             # personal best survives a reload
node dev/shots.js <outdir>      # phone screenshots: title, run, hide, search, close, caught, game over
node dev/stages.js <outdir>     # each stage, real touch hold/release, pause, desktop and small-phone layouts
node dev/trace.js               # one bot run, state every half second, with the event log
node dev/clip.js <outdir>       # ~22 s real-time video of the title and a bot run (Playwright, no audio)
```
