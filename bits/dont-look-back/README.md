# DON'T LOOK BACK

An endless 3D survival Bit for Plethora (`plethora-bit@2`, three.js 0.164.1), built for portrait phones and one finger.

You are a small hooded figure lost in an enormous haunted forest. Something tall is following you. You cannot fight it and you cannot turn around. You can only run, or hide and let it pass. The score is the distance you survive.

## Controls

| | Touch | Keyboard |
|---|---|---|
| Run | Hold anywhere | Space, W or ↑ (hold) |
| Steer | Slide the held finger left or right | A/D or ←/→ |
| Hide | Let go while **HIDE** is showing (cover within reach) | Release the run key |
| Leave cover | Press again (wait for **RUN**) | Run key |
| Pause | Pause button, top right | Esc or P |

## The rules the player learns

- **Breath** (the bar at the bottom) drains while running and comes back in cover. At zero you are **EXHAUSTED**: slower, unsteady, and you can't vault. It recovers only once you stop.
- **It always gains while you run.** Running buys distance, not safety. Its pace rises with difficulty, with how much noise you have made recently (heat), and when you are exhausted.
- **Standing in the open** lets you catch your breath slowly, but it closes in fast.
- **Hide** behind a great tree, in a hollow log, behind rocks, in a dense bush or inside an abandoned shack. Cover must be within reach on your side of the trail; an amber ring and the word **HIDE** mark it.
- **It passes you** if, when it reaches your cover:
  - it didn't see you go in (hiding when it is under about 5 m away doesn't work),
  - you haven't been hiding too long (7.8 s at the start, 5 s deep in), and
  - you've caught your breath (breath above 30–55, depending on depth). It hears you gasping.
  
  Otherwise it **stops and searches** your cover. **RUN** pulses, and you have a second or two to break cover with it close behind.
- While it is close, you hold your breath, so breath barely recovers.
- When it has passed, it wanders off the trail for a few seconds and then picks up your trail again. Leaving cover while it is within 4.5 m means capture; within 12 m, it notices you.
- **Obstacles**:
  - Low ones (fallen logs, exposed roots, a tree that falls across the trail) are vaulted automatically at running speed.
  - Thorns, collapsed branches, narrow gaps between trunks and the holes in broken bridges must be steered around.
  - Hitting one, or reaching a low one while exhausted, makes you stumble: you lose breath and ground.

## Pursuit states

The danger state always comes from the real pursuit distance (`run.M.gap`), never from a timer.

| State | Gap | What you get |
|---|---|---|
| Distant | > 22 m | eyes now and then through the fog, distant footfalls |
| Approaching | 10–22 m | louder spatial footfalls and breathing, drone and vignette rise |
| Immediate | < 10 m | heartbeat, low rumble, camera shake, a tighter field of view, amber eye-light on the ground around you, its shadow ahead of you |

## Structure

`build.js` concatenates `src/*.js` into the single-file entry `main.js`. Edit the sources, not `main.js`.

- `00_util.js`: maths, seeded RNG, value noise, the winding trail (`TRAIL`, `trailPoint`), ground height with ravines, the four stages (`STAGES`) and the difficulty curve.
- `01_assets.js`: procedural canvas textures (bark, leaf litter, glow, mist, moonbeam, treeline silhouettes), materials, and all low-poly geometry, merged with vertex colours. There are no external assets.
- `02_rigs.js`: the hooded wanderer and the follower as jointed rigs, with procedural animation.
  - Wanderer: idle, run, vault, hide, recover, trip, caught.
  - Follower: walk, stand, search, loom, lunge, with a head that twitches on its own.
- `03_world.js`: the streamed forest. 24 m chunks are generated ahead and recycled behind.
  - Every repeated prop is an `InstancedMesh` pool (object pooling), which keeps the scene to about 55 draw calls.
  - Places cover, obstacles, lanterns with a few shared real lights, shrines, shacks, fences, moonbeams and mist cards.
  - Handles the falling-tree event.
- `04_audio.js`: Web Audio.
  - Ambience: wind, leaves, drone, rumble, owls, creaks and whispers.
  - The wanderer: footsteps, ragged breath and heartbeat.
  - The follower: its breath and footfalls go through an HRTF panner placed at its position.
  - The hiding mix is low-passed.
- `05_ui.js`: CSS and the save format.
- `06_game.js`: input, the run/hide state machine, stamina, the pursuit AI, random events (eyes between the trees, a silhouette crossing, a figure standing, bats, a lantern dying, a fog surge, a falling tree), the camera, the HUD and the screen flow.

### Camera

- **Run:** behind and above you. It shakes with your footfalls, more when exhausted or in danger, and pulls closer as it nears.
- **Hide:** a still, low shot from up the trail, looking back past your cover at the way it will come.
- **Capture:** the camera finally turns around.

### Stages

The forest changes gradually; the fog, palette and density blend over the 120 m before each boundary.

| Stage | Name | From |
|---|---|---|
| I | The Forgotten Woods | 0 m |
| II | The Hollow Forest | 380 m |
| III | The Cursed Grounds | 950 m |
| IV | The Deep Dark | 1700 m |

## Run locally

```sh
node build.js
mkdir -p dev/vendor && curl -sS -o dev/vendor/three.module.js https://libs.plethora.studio/three/0.164.1/three.module.js
python3 -m http.server 8765        # from this folder, then open http://localhost:8765/dev/index.html
```

## Tests (headless Chromium via Playwright)

```sh
node dev/shoot.js shots      # title, run, cover, hide, the pass, resume, a run held until capture, game over
node dev/stages.js shots     # a screenshot in each later stage with an obstacle ahead
node dev/bot.js 10 0.8       # balance bot: plays 10 runs in simulation and reports distance, hides, passes, searches
```

The balance bot plays near-perfectly and reaches about 1.5–2 km (stages III–IV, 7–8 minutes) before the Deep Dark catches it. Holding to run without ever hiding gets caught at about 130 m (24 s).
