# The Unstable Table

A Plethora Bit (`plethora-bit@2`, planck.js 1.5.0, Canvas2D). It is a painted gouache still life on a seesaw. Drag curiosities from the shelf onto a tabletop that sits on a single pivot, and keep it level as the collection grows.

## How it plays

- **Place:** drag an object from the shelf. A dotted plumb line and a landing mark show where it will come down. The mark turns vermilion when there is no table below, and releasing there sends the object back to the shelf. On release it becomes a rigid body.
- **Reposition:** press any object on the table to lift it. Lifting takes its weight off the table, and anything resting on it is left unsupported, while the rest of the simulation keeps running.
- **Weight cue:** each waiting object shows one, two or three brass weights (light, medium, heavy). No numbers are shown.
- **Gauge:** a needle shows the table's real angle across three bands: balanced, unstable and critical.
- **Grace period:** the table may sit past its safe angle (17°) for up to one second. A ring around the gauge fills while it does.
- **Losing:** the game ends when an object touches the floor, or when the table stays past its safe angle for longer than the grace period. The cause is spelled out, and everything stays physical while it falls.
- **Arrivals:** for the first five placements, a new object arrives only when the shelf is empty. After that, objects arrive on a timer that shortens from 9 s to 3.2 s, and the shelf holds up to three at once.
- **Object tiers:** later objects are tall, top-heavy, round, slippery or heavy brass.
- **Fairness:** every arrival is checked so that it could be placed near the pivot without reaching the critical zone. When it could not, a different object is drawn.

## Scoring (`src/03b_score.js`)

The rules are small pure functions, tested in `dev/score_test.js`.

**Placement score** = (base + balance bonus) × steady-hand multiplier

| Part | Value |
|---|---|
| Base | 100 for each object that settles on the table, once per object |
| Balance bonus | Read from the table's actual angle once it stops swinging (or after 2.5 s). Within 2° +100, within 4° +70, within 6° +40, beyond that nothing |
| Steady hand | Consecutive stable placements: ×1, ×1.25, ×1.5, ×1.75, then ×2. The streak resets when the table enters the critical zone |
| Perfect Balance | +150 when the table was unstable for at least 0.4 s and is then held within 2° and still for 0.5 s |

**Limits on Perfect Balance:**
- It can be earned at most once per placed object.
- It is never awarded while an object is held.
- It needs a new unstable spell before it can be earned again.

**Repositioning never scores.** A lifted object keeps its "already scored" flag. An object lifted before it was scored is scored only once it settles again.

Every award is written to `run.log`. `dev/session_test.js` checks across full sessions that the score is exactly the sum of that log, and it lifts and re-drops pieces through real input to try to farm points. The score goes to the `score` leaderboard. The result certificate shows the top three and your rank.

## Physics (`src/03_phys.js`)

- **Table:** one dynamic body on a revolute joint at the pivot. The joint has ±25° end stops and a little joint friction, and the body has angular damping.
- **Ballast:** a brass plumb hangs 1.15 units below the pivot and does not collide with anything. Its restoring torque is M·g·L·sin θ.
- **Balance:** an off-centre load adds m·g·x, so the table settles where the two torques cancel.
- **Tall stacks:** they raise the combined centre of mass and wear down that restoring torque. This is where the late-game wobble comes from.
- **No animation:** nothing about the table's angle is animated.
- **Objects:** each object has an authored mass, centre of mass, convex collision pieces that follow its silhouette, friction, restitution and rolling resistance. They are defined in `src/02_objects.js`.
- **Determinism:** the simulation runs at a fixed 60 Hz. Rendering interpolates between steps.

## Art (`src/01_paint.js`, `02_objects.js`, `04_scene.js`)

- **Gouache:** everything is painted procedurally at start-up with a small gouache brush kit and drawn afterwards as sprites. The kit lays opaque base colour, then washes, dry-brush strokes, painted shadow and light sides, granulation and wobbly ink edges.
- **Paper:** a paper-grain multiply layer sits over the scene.
- **Collection:** 20 objects in four groups.
  - Ceramics: vase, teapot, bowl, bottle, cat, lidded pot.
  - Brass: candlestick, elephant, bell, armillary ornament, oil lamp.
  - Fruit: pomegranate, pear, grapes, pumpkin, coconut, lemon.
  - Curiosities: books, glass perfume bottle, framed miniature.

## Sound (`src/05_audio.js`)

WebAudio synthesis tuned per material and object size:

- ceramic clink
- brass resonance
- glass ring
- fruit thud
- books
- a wooden creak near the critical angle

The music uses `ctx.music` (ambient, dorian), and its intensity follows the gauge zone. A mute button sits under the best score.

## Run and test

```sh
node build.js                      # src/*.js -> main.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/planck.min.js https://libs.plethora.studio/planck/1.5.0/planck.min.js
curl -sS -o dev/vendor/dm400.ttf https://libs.plethora.studio/fonts/dm-serif-display/1.0.0/400.ttf
curl -sS -o dev/vendor/dm400i.ttf https://libs.plethora.studio/fonts/dm-serif-display/1.0.0/400-italic.ttf
python3 -m http.server 8765        # then open http://localhost:8765/dev/index.html
node dev/phys_test.js              # torque, counterbalance, leverage, settling, sliding, falling, determinism, lift/drop
node dev/play_test.js [outdir]     # drives the real Bit: drag, reposition, invalid drop, failure, result, replay
node dev/touch.js [outdir]         # real touch events at several phone sizes, legacy safe frame, sim cost
node dev/score_test.js             # scoring rules
node dev/session_test.js [runs]    # complete bot sessions: score = sum of events; repositioning cannot farm points
node dev/clip.js out.mp4           # records a gameplay clip (needs ffmpeg)
node dev/bot.js [runs]             # a counterbalancing bot, to chart difficulty
node dev/gallery.js out.png        # every object sprite
```
