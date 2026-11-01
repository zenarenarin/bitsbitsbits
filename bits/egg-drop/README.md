# EGG DROP

A physics balancing Bit for Plethora (`plethora-bit@2`, planck.js 1.5.0, Canvas2D). One egg rests on a long platform that pivots on a brass axle. A brass counterweight hangs from a rail under the deck. You drag the weight. You never touch the egg.

## The physics

Everything is a planck (Box2D) rigid body stepped at a fixed 120 Hz. Rendering interpolates between steps. Nothing sets the platform angle or the egg's position directly.

- **Platform**: one dynamic body made of the deck, two hangers and the rail. It turns on a revolute joint at the pivot, which has:
  - ±17.8° limits,
  - a little bearing friction (a zero-speed joint motor with a small torque cap),
  - angular damping.

  The rail hangs 0.8 m below the pivot, which makes the whole assembly a stiff pendulum (about 18 N·m/rad). Carriage position therefore maps progressively to tilt: 0.1 m gives about 4.8°, 0.3 m gives about 12°, and about 0.45 m reaches the stop.
- **Counterweight**: a 1.4 kg body on a prismatic joint along the rail, limited to ±1.36 m.
  - Touch and phone tilt both set the same target. A servo motor in the carriage drives toward it, and the reaction acts on the platform.
  - When nothing steers it, the motor brakes the carriage with only the rail's friction.
  - A finger moves the carriage 0.55 m per metre of drag.
- **Egg**: a single convex polygon of 300 vertices that traces exactly the drawn outline. It is a slightly asymmetric ovoid, aspect 1.05.
  - Sliding friction is static (μs) until the contact slips faster than 2.5 cm/s, then kinetic (μk). It is chosen per contact in `pre-solve`.
  - **Rolling resistance** is a Coulomb couple, separate from sliding friction. It is a planck `FrictionJoint` acting only on the egg's rotation relative to the deck, with a torque cap of `roll × normal load`, updated every step. So it holds the egg still up to a threshold, then resists rolling with a constant couple.
- **Disturbances** (`src/01_disturb.js`) are torques on the platform:
  - slow drift,
  - short nudges,
  - from about 35 s on, gusts announced 1.1 s ahead.

  They step up at 10 s, 25 s and 45 s (Learning, Instability, Pressure, Survival). A nudge never starts toward an egg that is already near an end. The total is soft-capped below what the carriage can answer.

| Surface | μs / μk | rolling resistance | starts moving at (slow tilt) | on a 17° tilt |
|---|---|---|---|---|
| Rubber | 1.05 / 0.85 | 0.018 | about 4.8° | rolls |
| Wood | 0.50 / 0.38 | 0.0085 | about 3.0° | rolls |
| Ceramic | 0.14 / 0.09 | 0.0035 | about 2.2° | rolls and slips |
| Metal | 0.07 / 0.04 | 0.0028 | about 1.9° | mostly slides |

### Bugs fixed in the physics refinement

- **The egg jammed on the deck.** It was assembled from wedge-shaped fixtures, because planck's default limit is 12 vertices per polygon. Two or three wedges touched the deck at once with conflicting normals, which held even a perfectly round egg on tilts of 7° or more. The egg is now one polygon (the vertex limit is raised).
- **Rolling resistance read double while the egg rested.** The egg's facets are a few millimetres long, so a two-point contact is nearly degenerate. The solver then solves one point and reports the second as a copy. Two points closer than 2 cm now count once.
- **The weight was too sensitive.** 0.1 m of carriage (about 9 px of finger) tilted the platform 8.7°, and 0.3 m hit the stop.
- **The game overrode the physics' defaults.** It passed its own tuning defaults for carriage mass and damping, which overrode the tested values.

## Play

- **Touch**: touch anywhere and drag sideways. The weight follows along the rail.
- **Phone tilt**: choose it on the start or results screen.
  1. Allow motion access. iOS asks in a system prompt.
  2. Hold the phone comfortably upright and tap **Calibrate**. That pose becomes zero.
  3. Tilt it like a steering wheel: right side down moves the weight right.

  The tilt setting has a sensitivity slider. The mapping has a 1.2° dead zone, an expo curve and 60 ms smoothing, and it rotates with the screen orientation (a rotation asks for a new calibration). In the Plethora app it uses the host's motion bridge (`ctx.motion`). Otherwise it uses `DeviceOrientationEvent`, calling `requestPermission()` from the tap where the browser has it, and only on a secure page.

  If permission is refused, no sensor exists, or the page isn't https, the panel says so and touch keeps working. If the sensor stops reporting during a run, control falls back to touch.
- The run starts on the first grab (or tap or tilt in tilt mode). The timer is your score.
- **Bonuses**:
  - **Steady**: within 1.5° for 5 s.
  - **Rescued**: from the last 0.5 m back to the middle.
  - **Weathered**: a gust passed.
  - **Light touch**: 10 s without hitting a rail stop or reaching past 0.9 m.

  Points are 10 per second plus bonuses.
- **Keyboard**: ←/→.

Records are `time` (Longest Balance, duration) and `score` (Balance Points). Both have a `surface` dimension.

## Build and run

```sh
node build.js                      # src/*.js -> main.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/planck.min.js https://libs.plethora.studio/planck/1.5.0/planck.min.js
python3 -m http.server 8765        # then open http://localhost:8765/dev/index.html
```

## Tests

```sh
node dev/scenarios.js   # physics checklist 1-9 plus torque, coupling, fairness and determinism checks
node dev/tilt.js        # phone tilt 10-17 and 22 against emulated sensors (not a physical-device test)
node dev/gameplay.js    # timer, score, difficulty and game-over checks 18-21
node dev/audit.js       # carriage-to-angle sensitivity, break-away per surface, creep at rest
node dev/shape.js       # break-away by direction for egg profiles
node dev/bot.js         # seeded survival times for no-input / novice / good / expert controllers on each surface
node dev/play.js        # real pointer drags in headless Chromium: start, both rail limits, fall, results, replay
node dev/edge.js        # dependency failure and retry, tilt granted and denied, three viewports, keyboard
node dev/frames.js wood # frame-stepped screenshots: gust warning, danger, fall, crack, results
node dev/perf.js        # ms per frame and per physics step
```
