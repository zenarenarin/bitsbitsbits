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

You manage three things: the creature's distance, your breath, and where the next cover is.

### Movement and breath (`TUNE` in `src/05_game.js`)

- **Hold, run**:
  - Speed is 6.2 m/s, rising to 8.4 with difficulty.
  - Breath (0–100) drains about 9 per second, more later.
  - Below 30 breath you slow down gradually.
- **Release in the open, walk** at 2 m/s. Breath barely recovers (0.8/s) and the creature closes faster.
- **Release in cover, hide**: you stop, crouch behind or inside the cover, and recover about 26 breath per second. This is the only real way to get breath back.
- **Exhausted** (breath 0): you run at 60% speed with heavy breathing and puffs, and the creature pushes a little harder. You're never stopped, so you can still reach cover. It lasts until breath is back to 25.
- **Score** is distance actually covered. It doesn't count while hidden (including the short glide into cover) or after death. The personal best is saved in Plethora storage with a `localStorage` fallback, also on pause, and submitted to the `score` leaderboard.

### Cover (`HIDE_SPOTS` in `src/01_world.js`)

| Cover | Safe time | Reach either side | Hidden as |
|---|---:|---:|---|
| Dense corn | 3 s | inside the clump | crouched among the stalks |
| Haystack | 4 s | 0.8 m | crouched behind the stack |
| Abandoned cart | 5 s | 0.8 m | crouched behind the tarp, hood showing |
| Hollow tree | 6 s | 0.9 m | inside; only your eyes show |
| Small shed | 7 s | 1.0 m | inside the doorway; only your eyes show |

- Safe times shrink by up to 25% as the run goes on. The long, safe kinds get rarer and corn gets more common.
- **Before you hide**:
  - Cover within reach glints along its top edge.
  - A **HIDE** tag appears, with a row of pips showing how many seconds of safety it offers.
  - Letting go glides you onto the cover's hiding point.
- **While hidden**:
  - The pips count down.
  - When they run out you are **exposed**: an alarm sounds, the pips flash, the cover shakes, the heartbeat quickens and a haptic fires.
- **Safe time is a property of the place, not a reset.** The hiding clock winds down slowly after you leave, so ducking in and out buys nothing.
- **Fair placement**:
  - Cover is never more than 40–50 m apart.
  - No obstacle is placed inside a hiding place or within its reach.
  - The first two hiding places are always corn, then a haystack.

### The creature (`updateCreature`)

Its distance is real (metres internally) and is read on a 0–100 pursuit scale: 100 means 40 m away and 0 means caught. It moves continuously and never jumps onto you.

| State | Internal modes | When | What you see and hear |
|---|---|---|---|
| **FOLLOWING** | `wake`, `hunt` at pursuit 65 or more, `withdraw`, `linger` | far, or giving up | a head above the far corn sinking in and out, distant steps |
| **HUNTING** | `hunt`, `reacquire` below 65 | it has your trail | shoulders and arms above the middle rows, its shadow on the path, louder steps; DANGER below 35; screen shear below about 15 |
| **SEARCHING** | `approach`, `sweep`, `check` | you hid | it walks to where it lost you, slows, looks around, sweeps right over your hiding place reaching into the crop |

- **Hunting**: it closes at its speed minus yours. Running holds it off for a while; walking, stumbling or being winded lets it gain.
- **When you hide**, it loses your trail and approaches.
  - It sweeps through the spot to 1.6 m, right over you. It can't detect you while your safe time lasts.
  - Then it turns and withdraws. A low "safe" chord plays, there's a light haptic, and pursuit pressure drops.
- **Stay too long**: when you're exposed it comes back, or turns back, and **checks** the spot. It reaches straight for you for 0.8–1.1 s, and if you're still there it finds you.
- **Bolting**:
  - Mid-sweep or mid-check: startles it briefly (it pulls its arm out of the crop), then the chase resumes very close.
  - As it walks away: it doesn't notice you until it stops.
  - Leaving cover right beside it, or hiding in front of it within 3 m: it saw you.

### Obstacles (`OBSTACLES`)

- **Hitboxes**:
  - Each obstacle has an extent along the path and a height band above it.
  - The traveller's body is tested against that band each step while they overlap. Vaulting raises the body, ducking lowers it.
  - Each obstacle can collide at most once.
- **Committing**: a step before an obstacle, the traveller commits based on how they are moving.
  - Running with breath: vault low obstacles and leap pits.
  - Walking: step over low obstacles and duck under snags.
- **Collisions** carry a stamina cost and also let the creature close in. A collision alone never brings it into catch range.

| Collision | Penalty |
|---|---|
| Low (pumpkin, root, fallen board, fallen log), running winded | trip 0.55 s, −8 breath, creature +1.5 m |
| Snag (barbed wire, harrow tines at chest height), running | snagged 0.85 s, −12 breath, creature +2.5 m, then duck through |
| Pit, walking or winded | fall 1.1 s, −12 breath, creature +3 m, climb out |

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

### Difficulty

- It stays flat for 15 s, then ramps over 70 s. Run speed and creature speed rise.
- **More demanding decisions**:
  - safe times shrink;
  - corn (the shortest cover) gets more common;
  - sections get longer, so cover is further apart;
  - harder section templates unlock: wire, machinery, woodpile, gauntlet;
  - crows get more frequent;
  - breath drains faster and recovers a little slower.

### Game states

- **Screens** (`MODES`): MENU, STARTING, PLAYING, PAUSED, CAUGHT and GAME_OVER.
  - Changes go through `setMode`, which refuses any transition not in `TRANSITIONS`.
  - The simulation steps only in STARTING and PLAYING. In PAUSED, CAUGHT, GAME_OVER and MENU nothing moves, scores or collides.
- **STARTING** waits for the first hold (the tap that started the run doesn't count). After 6 s it starts without you.
- **Player states** (`playerState()`) are RUNNING, WALKING, HIDING and EXHAUSTED. They're derived from the simulation, so they can't disagree with it.
- Restarting rebuilds the run in place without reloading.

## Rendering and performance

- **Rendering**: the whole picture is drawn with integer `fillRect`s into a low-resolution buffer (about 130×280 on a phone). That buffer is blitted with `imageSmoothingEnabled = false` at the largest whole-number scale that fits. There's no anti-aliasing, no gradients (ordered-dither seams only) and no post-processing that blurs.
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
node dev/scenarios.js           # the Stage 2 acceptance scenarios A-F plus states, input, crows, difficulty, persistence (41 checks)
node dev/gen.js                 # 20 km x 20 seeds: every cover type appears, cover gaps, obstacle spacing, nothing in cover's reach
node dev/bot.js [runs]          # policies through the real step function: hold forever, never hold, a sensible player
node dev/perf.js [throttle]     # frame cost while a bot plays in real time (CPU throttle, default 4x)
node dev/persist.js             # personal best survives a reload
node dev/spots.js <outdir>      # every kind of cover: within reach, and hidden while it searches
node dev/shots.js <outdir>      # phone screenshots: title, run, hide, search, close, caught, game over
node dev/stages.js <outdir>     # each stage, real touch hold/release, pause, desktop and small-phone layouts
node dev/trace.js               # one bot run, state every half second, with the event log
node dev/clip.js <outdir>       # ~22 s real-time video of the title and a bot run (Playwright, no audio)
```
