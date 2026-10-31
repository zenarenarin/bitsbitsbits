# EGG DROP

A physics balancing Bit for Plethora (`plethora-bit@2`, planck.js 1.5.0, Canvas2D). One egg rests on a long platform that pivots on a brass axle. A brass counterweight hangs from a rail under the deck. You drag the weight. You never touch the egg.

## The physics

Everything is a planck (Box2D) rigid body stepped at a fixed 120 Hz. Rendering interpolates between steps. Nothing sets the platform angle directly.

- **Platform**: one dynamic body. It is made of the deck, two hangers and the rail rod, so its mass and moment of inertia come from all of them. It turns on a revolute joint at the pivot, which has:
  - ±17.8° limits,
  - a little bearing friction (a zero-speed joint motor with a small torque cap),
  - angular damping.
- **Counterweight**: a dynamic body on a prismatic joint along the rail, limited to ±1.36 m.
  - While you hold it, a servo motor drives it toward your finger. The motor's reaction acts on the platform too, so you can feel the carriage's mass.
  - When you let go, the motor brakes the carriage with only the rail's friction.
  - Its lever arm changes the gravitational torque about the pivot. `dev/scenarios.js` checks that putting the carriage at −m_egg·x/m_cw cancels an off-centre egg, and that the measured torque matches.
- **Egg**: an asymmetric ovoid built from 10 convex fans (110 outline vertices), so it rolls on its curve and does not rest on flat faces. It has:
  - its own mass, centre of mass and inertia, and continuous collision;
  - static friction (μs) while the contact isn't slipping and kinetic friction (μk) once it slips past 2.5 cm/s, chosen per contact in `pre-solve`;
  - rolling resistance, a couple proportional to the measured normal load, applied equally and oppositely to the egg and the platform.
- **Disturbances** (`src/01_disturb.js`) are torques on the platform:
  - slow drift (three incommensurate waves plus a filtered random walk),
  - short raised-cosine nudges,
  - from about 35 s on, stronger gusts announced 1.1 s ahead by air streaks and a rising whoosh.

  They ramp through the four phases: Learning to 10 s, Instability to 25 s, Pressure to 45 s, then Survival. A nudge or gust never starts toward an egg that is already near an end. If the egg gets into trouble after a gust's cue has played, the gust lands at half strength. The total torque is soft-capped well below what the carriage can answer.

| Surface | μs | μk | rolling resistance | Break-away tilt |
|---|---|---|---|---|
| Rubber | 1.05 | 0.85 | 0.016 | about 12.4° |
| Wood | 0.55 | 0.42 | 0.005 | about 7.8° |
| Ceramic | 0.16 | 0.10 | 0.0035 | about 7.6° |
| Metal | 0.07 | 0.04 | 0.0015 | about 5.6°; slides rather than rolls on steep tilts |

## Play

- Touch anywhere and drag sideways. The weight follows your finger along the rail.
- The run starts on the first grab and the timer is your score.
- Bonuses:
  - **Level**: within 2° for 4 s.
  - **Rescued**: from the last 0.5 m back to the middle.
  - **Weathered**: a gust passed.
  - **Light touch**: 10 s without hitting a rail stop.
- Optional tilt control: the phone icon, shown only when the host offers motion. Drag always works.
- Keyboard: ←/→.

Records are `time` (Longest Balance, duration) and `score` (Balance Points). Both have a `surface` dimension. Your bests on this device are kept in `ctx.storage`.

## Build and run

```sh
node build.js                      # src/*.js -> main.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/planck.min.js https://libs.plethora.studio/planck/1.5.0/planck.min.js
python3 -m http.server 8765        # then open http://localhost:8765/dev/index.html
```

## Tests

```sh
node dev/scenarios.js   # the brief's 12 physics scenarios plus torque, friction, fairness and determinism checks
node dev/bot.js         # seeded survival times for no-input / novice / good / expert controllers on each surface
node dev/play.js        # real pointer drags in headless Chromium: start, both rail limits, fall, results, replay
node dev/edge.js        # dependency failure and retry, tilt granted and denied, three viewports, keyboard
node dev/frames.js wood # frame-stepped screenshots: gust warning, danger, fall, crack, results
node dev/perf.js        # ms per frame and per physics step
```
