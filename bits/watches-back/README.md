# THE THING THAT WATCHES BACK

A portrait, mobile-first psychological horror arcade Bit for Plethora (`plethora-bit@2`, three.js 0.164.1). A small figure is trapped in an enormous living spiral drawn in black ink on bone-white paper. The spiral's grooves are full of eyes.

**The rule players learn:** looking at an eye holds it still. Looking away lets it go. You can only hold one at a time, so every choice to watch one eye is a choice to leave the others unwatched.

The campaign is twenty spirals in four acts, each one inside the last. Endless mode unlocks once you have reached the centre.

## Controls

| | Touch | Keyboard and mouse |
|---|---|---|
| Walk along a groove | Drag in the lower left (a floating stick) | W A S D or the arrow keys |
| Step through an opening | Push toward (or away from) the centre at an opening; near one, you slide to it | The same |
| Look (gaze) | Touch anything on the spiral. A touch near an eye means that eye. The gaze stays where you left it when you lift your finger | Point with the mouse |
| Turn the spiral | Hold in the lower right and drag (a jog dial: the further you drag, the faster it turns) | Q and E (hold Shift for slow) |
| Pause | The pause button, top right | Esc or P |
| Begin this spiral again | Pause menu | R |

Walking and looking use different thumbs, so you can walk while holding an eye. Looking and turning also combine, because the gaze stays put. A setting swaps the stick and dial between hands. Cancelled touches, a lost window focus and a hidden page all release every input; a hidden page also pauses.

## The rules

### Space

- Each spiral is a set of concentric **grooves** (rings). Wall *k* sits between groove *k* and groove *k+1*. Its **openings** are the only way between them.
- **Rotation rule:** the groove you stand on holds still under your feet. Every other ring turns, in alternating directions, like gears. A wall turns with the ring inside it, so turning brings openings to you.
- **Barriers** are radial walls across a groove. **Veils** are long lashes on a wall that block sight, not movement. The dark **pupil** at the centre blocks sight across the spiral.
- Grooves are one-dimensional, so you can never walk past an eye. You have to move it, stop it, or go another way.

### Gaze

- The gaze is a direction from the traveller toward where you last looked.
- The eye it holds is the one nearest that direction, within a narrow cone widened by the eye's size.
  - Ties go to the nearer eye, then to the lower id.
  - The eye already held keeps priority only by a small margin.
- An eye cannot be targeted through a veil, through the pupil, or through another eye.
- The gaze holds an eye in stages:
  1. **Acquiring:** after 0.2 s of steady gaze, pins grow around it.
  2. **Pinned:** it stops moving and its pupil stops tracking.
  3. **Releasing:** for 0.35 s after the gaze leaves, it is still held.
  4. **Active** again.
- **A held eye in a groove is held still in the world.** If its ring turns, the ring slides beneath it, and the held eye shoves whatever it meets along the groove. If that would push something through a barrier or a fixed eye, the spiral jams and will not turn.
- Only one eye can be held, and held eyes still block the way, including yours. That is the constraint that keeps holding everything still from becoming the answer. There is no stamina meter.

### Eyes

| Eye | Behaviour | How it is beaten |
|---|---|---|
| **Watcher** | Creeps toward you along its groove. On another groove it keeps level with you and waits under your landing. | Hold it. Lead it away first. Hold it and turn its ring so the opening slides away from it. |
| **Drifter** | Blind and harmless. It drifts until something stops it, then turns back. | Hold it where it dams other eyes. |
| **Collector** | Moves to the nearest eye that looks. Once it has company it waits and draws more in. Three together become a **knot**: a solid mass that seals the way. | Hold the collector, or never let three meet. A long gaze (1.2 s) on a knot unravels it: the members are flung apart and reel. |
| **Liar** | Watched, it pretends to be held: lids drop, pupil turns away, the gaze thread looks taut. It is not held. It rides its ring when the spiral turns, and walking into it still kills. When you look away, it lunges by about 1.75 units for every second you watched it. | Watch it briefly, or let something else stop it. Its tells are the inhale (not a click), the fluttering lashes, the averted pupil, and sliding with its ring. |
| **Mimic** | Copies your walking 0.9 s late, by angle. Some mirror it. When you stop, it keeps coming for that 0.9 s. | Use the delay, hold it to break the copy, or turn its ring. Its footsteps echo yours, late. |
| **Sentinel** | Set into a wall, sweeping a cone. Staying in its sight for about 0.9 s is fatal. A moving eye that crosses its gaze draws its attention away for a moment. | Held, it sees nothing. Any eye between you and it hides you. Its cone is drawn cut short by whatever blocks it. |
| **False eye** | A drawing of an eye: harmless, not solid, never blinks, its pupil never follows you. It soaks up your gaze, and after 0.45 s its ink runs and the gaze passes through. | Watch for blinking and tracking, or test it with a glance. |
| **Choir** | A formation that moves as one. One member conducts: every 2.4 s the blink ripples outward from it, with a chord. | Holding the conductor breaks the song: the rest reel, then crawl on alone. Holding any other member only detaches that one. |
| **Unblinking** | Lidless, and gaze cannot hold it. It hunts across openings toward your groove and swallows unheld eyes it presses against. | Held eyes are walls to it. Lead it out of the way, and turn rings so its pocket and the openings never meet. |
| **Crown** | A two-ring formation that turns the spiral by itself and keeps the centre sealed. Holding the conductor of the whole, singing crown breaks one jewel, closed for good. After that the crown reels, then reforms around the next. | Three jewels. You need a line of sight, which usually means moving or turning, because its own eyes hide the conductor. |
| **Echo** | Moves the way you moved, replaying your recorded walking from earlier spirals. | Everything you have learned. |
| **Warden** | Set into a wall beside an opening that is open only while the warden is held. | Hold it while you step through. |

Causality is drawn. Whenever an eye reacts because of something you held (it is dammed, shoved, broken, or draws a sentinel's attention), a fine ink thread links them for a moment. Two or more reactions from one act is a **chain reaction**.

## The campaign

| Act | Spirals |
|---|---|
| I. Something Is Looking | 1 The First Eye (hold one eye) · 2 The Unwatched (two eyes; choose) · 3 The First Obstruction (a held eye dams others: the first chain) · 4 The Spiral Turns (rotation; hold an eye and turn its ring out from under it) |
| II. The System Moves | 5 The Drifter · 6 A Gathering (you decide where the knot forms) · 7 The Wrong Direction (the liar) · 8 Broken Formation (feed the liar to the collector) · 9 The Narrowing (five narrow rings, veils; turn just far enough to keep a held eye in sight) · 10 The First Hunt (hunters cross openings and aim where you are going; they wait on the side you have favoured so far this run) |
| III. It Learned Your Habits | 11 The Mimic · 12 The Sentinel · 13 The False Pattern · 14 The Choir · 15 The Repetition (Spiral 4's layout with a liar as keeper: the old answer fails because a feigning liar rides its ring; hold a drifter as a wedge instead) · 16 No Safe Direction |
| IV. The Thing That Watches Back | 17 The Convergence · 18 The Unblinking · 19 The Crown · 20 The Centre (silent and heavy to turn; your own echoes; to enter, you must look at the first eye) |

The ending is short and is not explained in text.

## Scoring

The score only counts things that happened:

- Each spiral: a base award, plus a time bonus under par, plus 150 per chain reaction and more for longer chains, plus 250 for a spiral cleared without being caught.
- Reaching the centre adds 3,000, or 4,500 if you were never caught.
- A capture in the campaign offers an immediate retry of that spiral. It is counted, and it loses the "unseen" bonus.
- In endless mode, one capture ends the run.
- Only full campaign runs (from Spiral 1) and endless runs are submitted to the leaderboards (`score` and `endless`). "Continue from Act N" runs are practice and are not ranked.

## Endless

Spirals are assembled from motifs the campaign has taught, unlocked by depth in the same order. Ring count, openings, barriers, veils and how many grooves are busy all scale with depth.

The spiral will not wait. After a par time, hunters (watchers that cross openings) enter your own stretch of groove at its far end, one more every 20 seconds.

A spiral is accepted only if all of these hold:

1. Three seconds of standing still at the start are safe.
2. A plain-minded bot reaches the centre in the real simulation within 75 s. The bot only turns the nearest opening toward itself, holds whatever threatens it most (it knows not to keep staring at a liar), and waits while the landing is unsafe.
3. From depth 3 on, the same bot **with its gaze disabled fails**, so looking is necessary. I added this rule after measuring that a gazeless bot could clear 60–70% of spirals without it.

Otherwise it is rerolled, up to 16 times. After that, a proven campaign spiral stands in.

Measured across 6 run seeds and depths 1–20: 119 of 120 spirals were generated and validated, and 1 fell back to a campaign spiral. Validating a candidate takes up to ~180 ms of simulation, so the next spiral is prepared in slices of about 3 ms per frame while you play the current one. Measured per-frame cost on the dev machine: median 4.7 ms, worst 27 ms. The descent never waits on generation unless you reach the centre before preparation finishes; in that case the rest is finished at once.

## Art and sound

- **Rings:** each ring's drawing is made once per spiral with Canvas 2D brushwork, unwrapped around the ring:
  - dry-brush walls with ragged faces and lips at each opening
  - lash veils and stitched barriers
  - groove hatching and three spiral arms that join up across rings only when the rings align
  - an olive-fibred iris around the pupil

  A shader wraps each drawing onto its annulus over procedural paper grain. The linework breathes slightly, more as dread rises; the "Steadier linework" setting calms it.
- **Eyes:** every eye is one instanced quad drawn entirely in a fragment shader. That covers lid shapes per type, iris fibres, pupil shapes (round, goat bar, slit, three, the stunned swirl), lashes, the pins of a held eye, the stitches of a closed one, and the running ink of a revealed false eye.
- **The traveller:** a signed-distance figure that turns its head toward its gaze, breathes, leans into its walk, hunches near threats, and is taken by ink on capture.
- **Sentinel cones:** raycast against the actual occluders each frame.
- **Colour:** the palette is ink, bone, ivory and a rare sickly olive. There is no neon, glow or red, and the overlay has no full-screen distortion.
- **Sound:** all procedural Web Audio.
  - a room tone that falls silent at the centre
  - dry friction while the spiral turns
  - a click and thud when an eye is held, an exhale on release
  - the liar's inhale
  - the choir's chord, which starts at its conductor
  - footsteps that the mimic echoes, late
  - a heartbeat for sentinel exposure, with a matching dark vignette
  - the Unblinking's drone

  Every cue that carries meaning has a visual counterpart.

## Code

`src/` is concatenated into `main.js` by `build.js` (UNMAKE's convention).

| File | Contents |
|---|---|
| `00_util.js` | math, seeded RNG |
| `01_defs.js` | every tunable rule (`RULES`), eye types, states |
| `02_sim.js` | the deterministic fixed-step (1/60 s) simulation: geometry, the traveller, crossing, gaze and occlusion, pin states, rotation with clutch, gears and jamming, every behaviour, formations, gatherings, sentinels, contact, chain tracking. No DOM, no three.js. |
| `03_encounters.js` | the campaign |
| `03_endless.js` | motifs, generator, validation bot |
| `04_art.js` | canvas brushwork and all shaders |
| `05_view.js` | builds and updates the scene from the simulation |
| `06_audio.js` | procedural sound |
| `07_ui.js` | DOM overlay |
| `08_game.js` | states, input, hints, scoring, transitions, the ending, saving, Plethora lifecycle |

## Run locally

```sh
node build.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/three.module.js https://libs.plethora.studio/three/0.164.1/three.module.js
python3 -m http.server 8766        # from this folder
# then open http://localhost:8766/dev/index.html
```

## Tests

```sh
node dev/test_core.js         # 54 checks: every mechanic and eye type on small hand-built spirals, determinism
node dev/test_campaign.js     # 64 checks: each encounter's intended plan reaches the centre, and still does when started
                              #   up to 1 s late; naive play fails everywhere; Spiral 15 punishes Spiral 4's old answer;
                              #   Spiral 10 for both habits; Spiral 20 against real recordings of the earlier plans
node dev/test_endless.js [seeds] [depth]  # start safety, bot validation, and "needs looking" for generated spirals
node dev/endless_browser.js <outdir>      # endless in the real game: locked until completion, several spirals, a capture ends the run
node dev/touch.js <outdir>    # emulated phone, real touch events: stick, two thumbs, gaze persistence, opening, dial, cancel, pause
node dev/playthrough.js <outdir>  # the whole campaign played through the real game in Chromium, ending and results
node dev/perf.js              # CPU cost per frame in the densest spirals; heap and GPU resources across restarts
node dev/sheet.js <id> <out.png> [plan|naive|idle]  # debug contact sheet of the simulation
node dev/shoot.js <outdir>    # screenshots of the title and several spirals
```

The browser tests need the local server on port 8766.

## What was and was not verified

- **Verified** by the tests above, run in this environment:
  - every mechanic in the simulation
  - every campaign spiral's solvability and its resistance to naive play
  - the whole campaign through the real game, from Spiral 1 to the results screen
  - touch input on an emulated 390×844 phone
  - endless validation
  - CPU cost: the simulation takes up to about 0.06 ms per step and the view update up to about 0.2 ms per frame in the densest spirals
  - stable heap across restarts
- **Not verified:**
  - **Real phones.** Headless Chromium renders with SwiftShader, so GPU frame time on actual devices is unmeasured. The heaviest GPU work is roughly seven full-screen-sized textured annuli and one instanced eye draw. Ring textures are at most 4096×(about 150) px each (3072 on small screens).
  - **Sound.** It was never heard here; only that it runs without errors.
  - **Difficulty for real players.** The plans prove each spiral can be solved, not how hard it feels.
- **Known simplifications:**
  - **The Unblinking emerges early.** In Spiral 18 it leaves through the outer opening on its own within a couple of seconds. Rushing in while the opening is still being turned therefore also works. The demanding part is keeping its pocket away from the opening while you descend.
  - **Unravelling isn't a route on every layout.** An unravelled knot throws its members to both sides, so it is a recovery more than a route. Spiral 6 is designed around leading the lookers elsewhere.
