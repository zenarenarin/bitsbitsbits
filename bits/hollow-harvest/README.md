# HOLLOW HARVEST

A pixel-art Halloween survival arcade Bit for Plethora (`plethora-bit@2`, plain 2D canvas, no dependencies). It is Halloween evening in an endless red cornfield, and something impossibly tall is walking behind the corn. You can't fight it. You can run, and you can hide.

## Controls

One finger, or one key.

| | Touch | Keyboard |
|---|---|---|
| Run | Hold anywhere | Hold Space, → or W |
| Hide | Let go inside the tall corn (a **HIDE** tag appears) | Release |
| Walk | Let go anywhere else | Release |
| Pause | Pause icon, top right | Esc or P |

## How it plays

- **Running** drains breath (the bar at the bottom). Below 30% you slow down; at zero you are winded until breath is back to 30%.
- **Hiding** only works in the tall clumps along the path. You crouch behind the stalks, breath recovers, and the field goes quiet. Five pips above your head show how long the hiding place will hold.
- **The creature** runs a real pursuit model on one variable, its distance (`gap`):
  - *hunt*: it closes at its speed minus yours, so running slows it down and walking, stumbling or being winded lets it gain.
  - *seek → search*: when you hide it loses your trail, walks to the spot and searches the corn beside you, reaching in with one arm.
  - If the pips run out while it is searching, it **finds** you. If you hide while it is within 2.8 m, it **saw** you.
  - *leave → lost*: if your nerve holds, it turns away and walks off. Leave cover while its back is turned and it won't notice until it stops. Stay hidden and it comes back.
  - Breaking cover mid-search startles it for a moment; then the chase is on, very close.
  - The hiding clock winds down slowly once you leave cover, so ducking out and straight back in buys nothing.
- **How it shows itself depends on the gap.** Distant: a head and hat above the far corn, sinking in and out of view. Approaching: shoulders and arms above the middle rows, with its shadow reaching along the path. Very close: towering right behind you, limbs over the crop. Below about 14 m a **DANGER** tag appears, the screen darkens, a dithered vignette closes in and, very close, the picture starts to shear.
- **Obstacles** all respond to the same hold-or-release input:
  - *Low* (pumpkins, roots, fallen boards): running vaults them, walking steps over them, running while winded trips you.
  - *Pits*: keep running to leap them. Anything slower falls in and has to climb out.
  - *Snags* (barbed wire, harrow tines at chest height): let go to duck under them; running into them snags you.
  - A one-line hint appears the first time you meet each kind.
- **Difficulty** stays flat for the first 15 s, then over about 70 s the run speed and the creature's speed rise, hiding places get shorter and further apart, and the hiding window shrinks from 6.0 s to 3.4 s.
- **Score** is distance in metres. The personal best is kept in Plethora storage, with `localStorage` as a fallback, and submitted to the `score` leaderboard.

## The field

- **Rendering**: the whole picture is drawn with integer `fillRect`s into a low-resolution buffer (about 130×280 on a phone). That buffer is blitted with `imageSmoothingEnabled = false` at the largest whole-number scale that fits, so every logical pixel is the same size. Wide screens are pillarboxed at 180 px wide.
- **No anti-aliasing anywhere**: lines are Bresenham, and ellipses and polygons are scanline fills. Gradients are flat bands joined by ordered-dither seams, and the darkening vignette is Bayer-dithered.
- **Palette** (`src/00_core.js`): four stage tables of the same named colours, mixed in sixths, so the light changes in deliberate steps.
  - The sky is dusty pink and peach over pale yellow.
  - The field is an unnatural crimson that runs into olive and almost-black stems.
  - Pumpkins and lanterns are the warm lights that remain.
- **Stages** by distance: THE HARVEST, THE WITHERING (120 m), THE HAUNTED FIELDS (260 m) and THE HOLLOW (420 m). The sun sinks, the sky darkens to burgundy, and later sections bring more pumpkins, carts and scarecrows.
- **Layers** (`src/02_scene.js`), back to front:
  - stepped clouds;
  - a low striped sun;
  - far and near hills with crooked trees, a windmill and a farmhouse with a lit window;
  - distant crimson corn;
  - middle rows;
  - the back row of tasselled stalks;
  - the path;
  - the olive foreground and the hiding clumps, which overlap the crouching traveller;
  - dark grass blades at the bottom edge.
- **The traveller** (`src/03_actors.js`): a hand-drawn hooded upper body with a green backpack, leaning with speed. Legs and arms are posed from an 8-step cycle for idle, run, walk, winded, crouch, duck, leap and lifted.
- **The creature** is built from pixel lines on a skeleton, so it stays on the grid at any size:
  - stilt legs of uneven length that move out of step;
  - very long arms that swing at a slower, different rate from the stride;
  - a torn coat, a sack head with stitches and a slouched hat;
  - two uneven glowing eyes;
  - loose pixels that crumble off its silhouette.
  It updates at a stop-motion rate.
- **World** (`src/01_world.js`): an endless sequence of nine section templates (harvest, rows, patch, refuge, hollows, wire, machinery, scarecrows, gauntlet). Each has jittered positions, difficulty-scaled spacing and props, and the same template never comes twice in a row. Behind the player, objects go back into a pool. Cover is guaranteed at least every 40–50 m.
- **Events**:
  - a flock of bats crossing the sky;
  - a scarecrow turning its head to follow you;
  - a pumpkin lighting up;
  - corn stirring with no wind;
  - the windmill stopping;
  - a figure on the ridge that is gone a moment later.
- **Audio** (`src/04_audio.js`): all procedural Web Audio.
  - Ambience: wind in the crops, crows, windmill creaks and a low bed.
  - Your footsteps, rustling corn and breathing, which gets heavier as you tire.
  - Its footsteps and rasping breath scale with proximity, and a distorted low layer rises with danger.
  - A heartbeat while it searches beside you.
  - Hiding closes a low-pass filter over the ambience.

## Build and run

```sh
node build.js                         # concatenates src/*.js into main.js
python3 -m http.server 8765           # from this folder, then open http://localhost:8765/dev/index.html
```

`dev/index.html` is a small stand-in for the Plethora runtime.

## Checks

```sh
node dev/gen.js                 # 20 km x 20 seeds: bounded pool, no obstacle in cover, spacing, cover gaps
node dev/bot.js [runs]          # policies through the real step function: hold forever, never hold, a sensible player
node dev/persist.js             # personal best survives a reload
node dev/shots.js <outdir>      # phone screenshots: title, run, hide, search, close, caught, game over
node dev/stages.js <outdir>     # each stage, real touch hold/release, pause, desktop and small-phone layouts
node dev/trace.js               # one bot run, state every half second
```
